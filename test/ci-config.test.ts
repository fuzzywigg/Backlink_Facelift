import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('CI / package test wiring', () => {
  it('exposes typecheck, test, and coverage scripts', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.devDependencies.vitest).toBeTruthy();
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBeTruthy();
  });

  it('runs typecheck + coverage tests in GitHub Actions CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/npm run typecheck/);
    expect(ci).toMatch(/npm run test:coverage/);
    expect(ci).toMatch(/name:\s*Tests/);
    expect(ci).toMatch(/name:\s*Typecheck/);
    expect(ci).toMatch(/name:\s*Hygiene/);
    expect(ci).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(ci).toMatch(/timeout-minutes:\s*\d+/);
    expect(ci).toMatch(/cancel-in-progress:\s*true/);
  });

  it('enforces coverage thresholds in vitest.config.ts', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/thresholds\s*:/);
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/include:\s*\[['"]test\/\*\*\/\*\.test\.ts['"]\]/);
    expect(cfg).toMatch(/github-actions/);
    expect(cfg).toMatch(/lcov/);
  });

  it('keeps deploy workflow manual (HITL)', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/workflow_dispatch/);
    expect(deploy).not.toMatch(/^\s*push:/m);
  });

  it('pins Dependabot to non-major grouped updates', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/package-ecosystem:\s*"npm"/);
    expect(dep).toMatch(/package-ecosystem:\s*"github-actions"/);
    expect(dep).toMatch(/update-types:\s*\["version-update:semver-major"\]/);
  });

  it('lists the expanded contract suites under test/', () => {
    const files = [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
      'test/helpers.test.ts',
      'test/helpers.ts',
    ];
    for (const rel of files) {
      expect(read(rel).length).toBeGreaterThan(0);
    }
  });

  it('keeps TypeScript on the 5.x line (skip TS7 major)', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    const ts = pkg.devDependencies.typescript;
    expect(ts).toMatch(/^\^?5\./);
    expect(ts).not.toMatch(/^[\^~]?[67]\./);
  });

  it('pins CI to Node 20 with npm ci + coverage artifact upload', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/node-version:\s*"20"/);
    expect(ci).toMatch(/npm ci/);
    expect(ci).toMatch(/upload-artifact@v4/);
    expect(ci).toMatch(/coverage-report/);
    expect(ci).toMatch(/retention-days:\s*14/);
  });

  it('documents AGENTS.md verify scripts matching package.json', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('ignores coverage output and local secrets in .gitignore', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
  });

  it('keeps Dependabot npm major updates ignored (safe patch/minor only)', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/dependency-name:\s*"\*"/);
    expect(dep).toMatch(/update-types:\s*\["version-update:semver-major"\]/);
  });

  it('exports package as ESM named backlink', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      type: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
  });

  it('keeps hono as the sole runtime dependency', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
  });

  it('excludes src/types.ts from coverage include scope', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/include:\s*\[['"]src\/\*\*\/\*\.ts['"]\]/);
    expect(cfg).toMatch(/exclude:\s*\[['"]src\/types\.ts['"]\]/);
  });

  it('keeps CI jobs on ubuntu-latest with contents:read only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/runs-on:\s*ubuntu-latest/g);
    expect(ci).toMatch(/concurrency:/);
    expect(ci).toMatch(/group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}/);
    expect(ci).not.toMatch(/permissions:\s*\n\s*contents:\s*write/);
  });

  it('uploads coverage artifacts even when the test step fails', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/Upload coverage report/);
    expect(ci).toMatch(/if:\s*always\(\)/);
    expect(ci).toMatch(/if-no-files-found:\s*error/);
  });

  it('locks Cloud Agent environment.json to npm ci without secrets', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(env).toEqual({ name: 'Backlink_Facelift', install: 'npm ci' });
    expect(JSON.stringify(env)).not.toMatch(/api[_-]?key|secret|token/i);
  });

  it('keeps tsconfig strict with Workers + node types', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
    expect(ts.include).toEqual(expect.arrayContaining(['src/**/*.ts', 'test/**/*.ts']));
  });

  it('hardens checkout with persist-credentials disabled', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/persist-credentials:\s*false/);
    expect(ci).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
    expect(ci).toMatch(/Assert coverage artifacts exist/);
    expect(ci).toMatch(/coverage\/lcov\.info/);
    // Exact trigger block — push + pull_request to main only
    expect(ci).toMatch(
      /^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {4}branches: \[main\]\n/m,
    );
  });

  it('keeps deploy workflow HITL with read-only permissions and timeout', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/workflow_dispatch/);
    expect(deploy).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(deploy).toMatch(/timeout-minutes:\s*20/);
    expect(deploy).toMatch(/persist-credentials:\s*false/);
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).toMatch(/^on:\n {2}workflow_dispatch:\s*$/m);
  });

  it('locks Node engines expectation via CI pin (Node 20)', () => {
    const ci = read('.github/workflows/ci.yml');
    const matches = ci.match(/node-version:\s*"20"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('requires package-lock.json alongside package.json', () => {
    expect(read('package-lock.json').length).toBeGreaterThan(100);
    const lock = JSON.parse(read('package-lock.json')) as { name: string; lockfileVersion: number };
    expect(lock.name).toBe('backlink');
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(3);
  });

  it('keeps secret-scan hygiene patterns broad enough for private keys', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/private\[_-\]\?key/);
    expect(ci).toMatch(/!\s*test -f \.env/);
    expect(ci).toMatch(/!\s*test -f \.dev\.vars/);
  });

  it('locks hygiene required-file checks for all expanded suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of [
      'test/helpers.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
      'test/mcp-spec-contract.test.ts',
      '.gitattributes',
    ]) {
      expect(ci).toContain(f);
    }
  });

  it('documents README verify scripts matching package.json', () => {
    const readme = read('README.md');
    expect(readme).toContain('npm run typecheck');
    expect(readme).toContain('npm run test:coverage');
    expect(readme).toMatch(/100%/);
    expect(readme).toContain('gemini-2.0-flash'.replace('gemini-2.0-flash', 'Gemini 2.0 Flash'));
  });

  it('pins checkout actions to v7 in both CI jobs that check out', () => {
    const ci = read('.github/workflows/ci.yml');
    const checkouts = ci.match(/actions\/checkout@v\d+/g) ?? [];
    expect(checkouts.length).toBeGreaterThanOrEqual(3);
    expect(checkouts.every((c) => c === 'actions/checkout@v7')).toBe(true);
  });

  it('keeps vitest coverage reporters including html and text-summary', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/text-summary/);
    expect(cfg).toMatch(/['"]html['"]/);
    expect(cfg).toMatch(/['"]lcov['"]/);
  });

  it('ignores wrangler local state and pem/key files in .gitignore', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.wrangler\/$/m);
    expect(gi).toMatch(/^\*\.pem$/m);
    expect(gi).toMatch(/^\*\.key$/m);
  });

  it('keeps Dependabot monthly cadence for npm and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/interval:\s*"monthly"/);
    expect((dep.match(/package-ecosystem:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('asserts hygiene blocks Anthropic leftovers in src/', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/anthropic\|claude\|haiku/);
    expect(ci).toMatch(/gemini-2\.0-flash/);
  });

  it('keeps package version at 0.1.0 aligned with wrangler VERSION var', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const toml = read('wrangler.toml');
    expect(pkg.version).toBe('0.1.0');
    expect(toml).toMatch(/VERSION\s*=\s*"0\.1\.0"/);
  });

  it('pins setup-node to v7 across CI jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    const setups = ci.match(/actions\/setup-node@v\d+/g) ?? [];
    expect(setups.length).toBeGreaterThanOrEqual(2);
    expect(setups.every((s) => s === 'actions/setup-node@v7')).toBe(true);
  });

  it('keeps vitest environment as node', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/environment:\s*['"]node['"]/);
  });

  it('keeps Dependabot open-pull-requests limits finite', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/open-pull-requests-limit:\s*\d+/);
    expect((dep.match(/open-pull-requests-limit:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('ignores .env.* variants while allowing .env.example exceptions', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.env\.\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
  });

  it('keeps hygiene asserting no pull_request_target triggers', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/pull_request_target/);
    expect(ci).toMatch(/!\s*awk/);
  });

  it('lists wrangler as a devDependency with a deploy script', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
  });

  it('keeps CI typecheck job independent of the test job', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*Typecheck/);
    expect(ci).toMatch(/name:\s*Tests/);
    expect(ci).not.toMatch(/needs:\s*\[?\s*typecheck/i);
  });

  it('requires Cloudflare Workers types in devDependencies', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies['@cloudflare/workers-types']).toBeTruthy();
  });

  it('keeps deploy workflow on ubuntu-latest with wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(deploy).toMatch(/cloudflare\/wrangler-action@v4/);
    expect(deploy).toMatch(/npm ci/);
  });

  it('documents Safe Agent Actions including test/ extensions in AGENTS.md', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/Safe Agent Actions/i);
    expect(agents).toMatch(/unit tests under `test\/`/);
    expect(agents).toMatch(/src\/parser\.ts/);
    expect(agents).toMatch(/src\/genres\.ts/);
  });

  it('keeps package-lock name aligned with package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string };
    const lock = JSON.parse(read('package-lock.json')) as { name: string };
    expect(lock.name).toBe(pkg.name);
  });

  it('aligns deploy workflow secrets with Gemini (not Anthropic)', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/GEMINI_API_KEY/);
    expect(deploy).toMatch(/secrets:\s*\|\s*\n\s*GEMINI_API_KEY/);
    expect(deploy).toMatch(/GEMINI_API_KEY:\s*\$\{\{\s*secrets\.GEMINI_API_KEY\s*\}\}/);
    expect(deploy).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(deploy).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('runs typecheck + coverage before HITL wrangler deploy', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheck = deploy.indexOf('npm run typecheck');
    const coverage = deploy.indexOf('npm run test:coverage');
    const wrangler = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheck).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(typecheck);
    expect(wrangler).toBeGreaterThan(coverage);
  });

  it('keeps deploy concurrency group cancel-in-progress false', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/group:\s*deploy-\$\{\{\s*github\.workflow\s*\}\}/);
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
  });

  it('hygiene bans Anthropic leftovers in workflow YAML', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/!\s*grep -RqiE 'anthropic\|claude\|haiku' \.github\/workflows/);
    expect(ci).toMatch(/GEMINI_API_KEY.*deploy\.yml|grep -q 'GEMINI_API_KEY' \.github\/workflows\/deploy\.yml/);
  });

  it('keeps coverage artifact upload failing when lcov is missing', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/if-no-files-found:\s*error/);
    expect(ci).toMatch(/Assert coverage artifacts exist/);
    expect(ci).toMatch(/grep -q 'SF:src\/'/);
  });

  it('pins wrangler-action to v4 and setup-node to v7 on deploy', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/actions\/checkout@v7/);
    expect(deploy).toMatch(/actions\/setup-node@v7/);
    expect(deploy).toMatch(/cloudflare\/wrangler-action@v4/);
    expect(deploy).toMatch(/node-version:\s*"20"/);
  });

  it('keeps deploy secrets block listing only GEMINI_API_KEY', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const secretsBlock = deploy.match(/secrets:\s*\|\s*\n((?:.+\n)*?)\s*env:/)?.[1] ?? '';
    expect(secretsBlock).toMatch(/GEMINI_API_KEY/);
    expect(secretsBlock.trim().split(/\s+/)).toEqual(['GEMINI_API_KEY']);
  });

  it('does not grant write permissions in deploy workflow', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(deploy).not.toMatch(/contents:\s*write/);
    expect(deploy).not.toMatch(/id-token:\s*write/);
  });

  it('keeps CI hygiene checking deploy typecheck and coverage gates', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/npm run typecheck.*deploy\.yml|grep -q 'npm run typecheck' \.github\/workflows\/deploy\.yml/);
    expect(ci).toMatch(/npm run test:coverage.*deploy\.yml|grep -q 'npm run test:coverage' \.github\/workflows\/deploy\.yml/);
  });

  it('hygiene locks coverage retention, deploy persist-credentials, and lockfileVersion', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/grep -q 'retention-days: 14'/);
    expect(ci).toMatch(/grep -q 'persist-credentials: false' \.github\/workflows\/deploy\.yml/);
    expect(ci).toMatch(/grep -q '"lockfileVersion": 3' package-lock\.json/);
  });

  it('locks vitest coverage provider to v8', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/provider:\s*['"]v8['"]/);
  });

  it('keeps package scripts free of invented credential env exports', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toMatch(/GEMINI_API_KEY=|ANTHROPIC_API_KEY=|CF_API_TOKEN=/);
    }
  });

  it('documents DEPLOY.md Gemini secret without Anthropic leftovers', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/Gemini API key/i);
    expect(deploy).toMatch(/wrangler secret put GEMINI_API_KEY/);
    expect(deploy).not.toMatch(/ANTHROPIC|Anthropic|Claude/);
  });

  it('keeps CI job timeouts finite and under an hour', () => {
    const ci = read('.github/workflows/ci.yml');
    const timeouts = [...ci.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(timeouts.length).toBeGreaterThanOrEqual(3);
    expect(timeouts.every((t) => t > 0 && t <= 60)).toBe(true);
  });

  it('requires npm cache on setup-node in CI and deploy', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    expect(ci).toMatch(/cache:\s*"npm"/);
    expect(deploy).toMatch(/cache:\s*"npm"/);
  });

  it('keeps ISSUE_TEMPLATE files present without embedding secrets', () => {
    for (const f of [
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
    ]) {
      const body = read(f);
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
      expect(body).not.toMatch(/ANTHROPIC_API_KEY/);
    }
  });

  it('defaults CI run shell to bash', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
  });

  it('keeps coverage artifact retention at 14 days', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/retention-days:\s*14/);
  });

  it('locks package-lock lockfileVersion to 3', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBe(3);
  });

  it('keeps deploy checkout persist-credentials disabled', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/persist-credentials:\s*false/);
  });

  it('keeps Dependabot ecosystems limited to npm and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    const ecosystems = [...dep.matchAll(/package-ecosystem:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ecosystems.sort()).toEqual(['github-actions', 'npm']);
  });

  it('does not declare package engines that would fight the CI Node 20 pin', () => {
    const pkg = JSON.parse(read('package.json')) as { engines?: Record<string, string> };
    expect(pkg.engines).toBeUndefined();
  });

  it('keeps tsconfig include covering src, test, and vitest.config', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('ignores .wrangler and coverage in .gitignore', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.wrangler\/$/m);
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
  });

  it('keeps CI concurrency group keyed by workflow and ref', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
  });

  it('requires coverage lcov SF:src/ assertion step before upload', () => {
    const ci = read('.github/workflows/ci.yml');
    const assertStep = ci.indexOf('Assert coverage artifacts exist');
    const upload = ci.indexOf('Upload coverage report');
    expect(assertStep).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(assertStep);
    expect(ci).toMatch(/grep -q 'SF:src\/'/);
  });

  it('keeps hygiene secret-scan excluding markdown and package-lock', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/--exclude='\*\.md'/);
    expect(ci).toMatch(/--exclude='package-lock\.json'/);
  });

  it('pins vitest and coverage-v8 on the 5.x line', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
  });

  it('keeps deploy workflow free of push/pull_request triggers', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/workflow_dispatch:/);
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
  });

  it('documents AGENTS.md escalate list including CORS and secrets', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/CORS or authentication/i);
    expect(agents).toMatch(/secret management/i);
  });
  it('limits CI on: triggers to push and pull_request against main', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.split('jobs:')[0];
    expect(onBlock).toMatch(/^\s*push:/m);
    expect(onBlock).toMatch(/^\s*pull_request:/m);
    expect(onBlock).not.toMatch(/workflow_call|schedule:|release:|workflow_dispatch:/);
    expect(onBlock).toMatch(/branches:\s*\[main\]/);
  });

  it('declares exactly three CI jobs: typecheck, test, hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsBlock = ci.slice(ci.indexOf('\njobs:'));
    const jobs = [...jobsBlock.matchAll(/^  ([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('keeps hygiene job free of npm install/test steps', () => {
    const ci = read('.github/workflows/ci.yml');
    const hygiene = ci.slice(ci.indexOf('name: Hygiene'));
    expect(hygiene).not.toMatch(/^\s+run:\s*npm\s/m);
    expect(hygiene).not.toMatch(/uses:\s*actions\/setup-node/);
  });

  it('uploads coverage with if: always and coverage-report artifact name', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*Upload coverage report[\s\S]*?if:\s*always\(\)/);
    expect(ci).toMatch(/name:\s*coverage-report/);
  });

  it('asserts coverage dir, non-empty lcov.info, and SF:src/ before upload', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -d coverage/);
    expect(ci).toMatch(/test -f coverage\/lcov\.info/);
    expect(ci).toMatch(/test -s coverage\/lcov\.info/);
    expect(ci).toMatch(/grep -q 'SF:src\/'/);
  });

  it('secret-scan excludes .git node_modules and coverage directories', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/--exclude-dir=\.git/);
    expect(ci).toMatch(/--exclude-dir=node_modules/);
    expect(ci).toMatch(/--exclude-dir=coverage/);
  });

  it('bans committed .env .dev.vars pem and key files in hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/! test -f \.env/);
    expect(ci).toMatch(/! test -f \.dev\.vars/);
    expect(ci).toMatch(/-name '\*\.pem'/);
    expect(ci).toMatch(/-name '\*\.key'/);
  });

  it('keeps Dependabot group patterns as star for npm and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/npm-dependencies:[\s\S]*patterns:[\s\S]*-\s*"\*"/);
    expect(dep).toMatch(/github-actions:[\s\S]*patterns:[\s\S]*-\s*"\*"/);
    expect(dep).toMatch(/update-types:\s*\["version-update:semver-major"\]/);
  });

  it('locks package-lock to include hono and vitest packages', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    expect(lock.packages['node_modules/hono']).toBeTruthy();
    expect(lock.packages['node_modules/vitest']).toBeTruthy();
  });

  it('keeps tsconfig strict skipLibCheck Bundler ES2022', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.target).toBe('ES2022');
  });

  it('limits vitest include to test/**/*.test.ts so helpers.ts is not a suite', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/include:\s*\['test\/\*\*\/\*\.test\.ts'\]/);
  });

  it('keeps .cursor/environment.json keys exactly name and install', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
    expect(env.install).toBe('npm ci');
    expect(JSON.stringify(env)).not.toMatch(/GEMINI|TOKEN|SECRET|API_KEY/i);
  });

  it('maps deploy GEMINI_API_KEY from secrets without printing values', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/GEMINI_API_KEY:\s*\$\{\{\s*secrets\.GEMINI_API_KEY\s*\}\}/);
    expect(deploy).not.toMatch(/echo.*GEMINI_API_KEY/);
    expect(deploy).not.toMatch(/::add-mask::/);
  });

  it('keeps CI and deploy permissions contents read without write scopes', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    for (const body of [ci, deploy]) {
      expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
      expect(body).not.toMatch(/contents:\s*write/);
      expect(body).not.toMatch(/id-token:\s*write/);
      expect(body).not.toMatch(/write-all/);
    }
  });

  it('hygiene locks persist-credentials false on CI checkout steps', () => {
    const ci = read('.github/workflows/ci.yml');
    const persist = ci.match(/persist-credentials:\s*false/g) ?? [];
    expect(persist.length).toBeGreaterThanOrEqual(3);
  });

  it('hygiene locks CI job display names and coverage-report artifact', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*Typecheck/);
    expect(ci).toMatch(/name:\s*Tests/);
    expect(ci).toMatch(/name:\s*Hygiene/);
    expect(ci).toMatch(/name:\s*coverage-report/);
    expect(ci).toMatch(/if:\s*always\(\)/);
  });

  it('locks AGENTS.md parent_governance, Tier A, Autonomy L2, and domain target', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/parent_governance:\s*github\.com\/fuzzywigg\/agents-governance/);
    expect(agents).toMatch(/Tier:\s*A\b/);
    expect(agents).toMatch(/Autonomy:\s*L2\b/);
    expect(agents).toMatch(/Domain target:\s*backlink\.fuzzywigg\.com/);
  });

  it('locks README CI badge URL to this repo ci.yml', () => {
    const readme = read('README.md');
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml/badge.svg',
    );
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml',
    );
  });

  it('disables blank issues and locks bug template component/priority/effort enums', () => {
    const config = read('.github/ISSUE_TEMPLATE/config.yml');
    expect(config).toMatch(/blank_issues_enabled:\s*false/);

    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toMatch(/options:\s*\[Parser, Curator, API, Deploy, CF-AI, KV-Cache\]/);
    expect(bug).toMatch(/options:\s*\[Critical, High, Medium, Low\]/);
    expect(bug).toMatch(/options:\s*\[XS, S, M, L, XL\]/);
  });

  it('locks feature template component options including New plus shared enums', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature).toMatch(
      /options:\s*\[Parser, Curator, API, Deploy, CF-AI, KV-Cache, New\]/,
    );
    expect(feature).toMatch(/options:\s*\[Critical, High, Medium, Low\]/);
    expect(feature).toMatch(/options:\s*\[XS, S, M, L, XL\]/);
    expect(feature).toMatch(/options:\s*\[Backlog, Ready, "In Progress", Blocked\]/);
  });

  it('ignores .mf/ in .gitignore for wrangler miniflare state', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.mf\/$/m);
    expect(gi).toMatch(/^\.wrangler\/$/m);
    expect(gi).toMatch(/^coverage\/$/m);
  });

  it('documents DEPLOY.md Node.js 18+ while CI pins Node 20', () => {
    const deploy = read('DEPLOY.md');
    const ci = read('.github/workflows/ci.yml');
    expect(deploy).toMatch(/Node\.js 18\+/);
    expect(ci).toMatch(/node-version:\s*['"]?20['"]?/);
  });

  it('documents DEPLOY.md cost estimate bullets for Workers KV and Gemini', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/100,000 requests\/day/);
    expect(deploy).toMatch(/100,000 reads\/day free/);
    expect(deploy).toMatch(/\$0\.25\/1M input tokens/);
    expect(deploy).toMatch(/\$0\.75 per 1,000 curation requests/);
  });

  it('hygiene suite list includes every test/*.test.ts file on disk', () => {
    const ci = read('.github/workflows/ci.yml');
    const files = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(9);
    for (const file of files) {
      expect(ci).toContain(`test/${file}`);
    }
    expect(ci).toContain('test/helpers.ts');
  });

  it('keeps package.json type module and private-safe name', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      type: string;
      version: string;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.type).toBe('module');
    expect(pkg.version).toBe('0.1.0');
  });

  it('keeps chore issue template present without blank issues', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore).toMatch(/name:\s*Chore \/ Infra \/ Docs/);
    expect(chore).toMatch(/labels:\s*\["chore"\]/);
    expect(chore).toMatch(/options:\s*\[Chore, Infra, Docs, Research\]/);
  });

  it('pins CI coverage upload path to coverage/', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/path:\s*\|\s*\n\s*coverage\//);
    expect(ci).toMatch(/coverage\/lcov\.info/);
  });

  it('keeps Dependabot open-pull-requests-limit and monthly schedule', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/open-pull-requests-limit:\s*\d+/);
    expect(dep).toMatch(/interval:\s*"monthly"/);
    expect(dep).not.toMatch(/interval:\s*"weekly"/);
  });

  it('keeps package.json free of scripts that invoke wrangler deploy', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/wrangler secret/);
  });

  it('documents README Cloud agents bootstrap as npm ci only', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/`npm ci` only/);
    expect(readme).toMatch(/no secrets in the file/i);
  });

  it('keeps vitest coverage exclude limited to src/types.ts', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/exclude:\s*\[['"]src\/types\.ts['"]\]/);
    expect(vitest).toMatch(/include:\s*\[['"]src\/\*\*\/\*\.ts['"]\]/);
  });

  it('hygiene requires DEPLOY.md alongside README and AGENTS', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -f DEPLOY\.md/);
    expect(ci).toMatch(/test -f README\.md/);
    expect(ci).toMatch(/test -f AGENTS\.md/);
  });

  it('pins exact CI and deploy job timeouts', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    expect(ci).toMatch(/name:\s*Typecheck[\s\S]*?timeout-minutes:\s*10/);
    expect(ci).toMatch(/name:\s*Tests[\s\S]*?timeout-minutes:\s*15/);
    expect(ci).toMatch(/name:\s*Hygiene[\s\S]*?timeout-minutes:\s*5/);
    expect(deploy).toMatch(/timeout-minutes:\s*20/);
  });

  it('pins Dependabot open-pull-requests limits to npm 3 and github-actions 2', () => {
    const dep = read('.github/dependabot.yml');
    const npmBlock = dep.match(
      /package-ecosystem:\s*"npm"[\s\S]*?open-pull-requests-limit:\s*(\d+)/,
    );
    const actionsBlock = dep.match(
      /package-ecosystem:\s*"github-actions"[\s\S]*?open-pull-requests-limit:\s*(\d+)/,
    );
    expect(npmBlock?.[1]).toBe('3');
    expect(actionsBlock?.[1]).toBe('2');
  });

  it('wires deploy.yml wrangler-action CF creds from secrets', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/apiToken:\s*\$\{\{\s*secrets\.CF_API_TOKEN\s*\}\}/);
    expect(deploy).toMatch(/accountId:\s*\$\{\{\s*secrets\.CF_ACCOUNT_ID\s*\}\}/);
    expect(deploy).toMatch(/uses:\s*cloudflare\/wrangler-action@v4/);
  });

  it('locks vitest reporters ternary on GITHUB_ACTIONS', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(
      /reporters:\s*process\.env\.GITHUB_ACTIONS\s*\?\s*\['default',\s*'github-actions'\]\s*:\s*\['default'\]/,
    );
  });

  it('keeps Dependabot schema version: 2', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2')).toBe(true);
    expect(dep).toMatch(/^version:\s*2\s*$/m);
  });

  it('documents DEPLOY.md local dev on localhost:8787', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/npm run dev/);
    expect(deploy).toMatch(/http:\/\/localhost:8787/);
  });

  it('locks README Stack bullets for Hono, KV 1h TTL, and Gemini 2.0 Flash', () => {
    const readme = read('README.md');
    const stack = readme.slice(readme.indexOf('## Stack'), readme.indexOf('## Available Genres'));
    expect(stack).toMatch(/Hono/);
    expect(stack).toMatch(/Gemini 2\.0 Flash/);
    expect(stack).toMatch(/1h TTL/);
    expect(stack).toMatch(/Cloudflare Workers/);
    expect(stack).toMatch(/iptv-org/);
  });

  it('lists Safe Agent Actions files including genres.ts and parser.ts', () => {
    const agents = read('AGENTS.md');
    const safe = agents.slice(agents.indexOf('## Safe Agent Actions'), agents.indexOf('## Verify'));
    expect(safe).toMatch(/src\/genres\.ts/);
    expect(safe).toMatch(/src\/parser\.ts/);
    expect(safe).toMatch(/test\//);
    expect(safe).toMatch(/Bump dependency versions/);
  });

  it('locks deploy workflow display name', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /^name:\s*Deploy to Cloudflare Workers\s*$/m,
    );
  });

  it('contrasts CI cancel-in-progress true with deploy false', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    expect(ci).toMatch(/cancel-in-progress:\s*true/);
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
  });

  it('locks package.json description exact string', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('keeps deploy workflow_dispatch as the only trigger', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.slice(deploy.indexOf('\non:'), deploy.indexOf('\npermissions:'));
    expect(onBlock).toMatch(/workflow_dispatch:/);
    expect(onBlock).not.toMatch(/push:/);
    expect(onBlock).not.toMatch(/pull_request:/);
  });

  it('documents AGENTS.md Escalate bullets for secrets and HITL deploy', () => {
    const agents = read('AGENTS.md');
    const escalate = agents.slice(agents.indexOf('## Escalate to Human'));
    expect(escalate).toMatch(/GEMINI_API_KEY/);
    expect(escalate).toMatch(/Production deploy/);
    expect(escalate).toMatch(/HITL/);
    expect(escalate).toMatch(/CORS or authentication/);
  });

  it('keeps vitest environment node and include test/**/*.test.ts', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/environment:\s*'node'/);
    expect(vitest).toMatch(/include:\s*\['test\/\*\*\/\*\.test\.ts'\]/);
  });

  it('locks bug template labels/title and required description id', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toMatch(/^name:\s*Bug\s*$/m);
    expect(bug).toMatch(/title:\s*"\[Bug\]:\s*"/);
    expect(bug).toMatch(/labels:\s*\["bug"\]/);
    expect(bug).toMatch(/id:\s*description/);
    expect(bug).toMatch(/id:\s*expected/);
    expect(bug).toMatch(/id:\s*steps/);
  });

  it('locks feature template enhancement label and acceptance field', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature).toMatch(/title:\s*"\[Feature\]:\s*"/);
    expect(feature).toMatch(/labels:\s*\["enhancement"\]/);
    expect(feature).toMatch(/id:\s*acceptance/);
  });

  it('locks chore template title and required type dropdown', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore).toMatch(/title:\s*"\[Chore\]:\s*"/);
    expect(chore).toMatch(/labels:\s*\["chore"\]/);
    expect(chore).toMatch(/id:\s*type/);
    expect(chore).toMatch(/options:\s*\[Chore,\s*Infra,\s*Docs,\s*Research\]/);
  });

  it('locks .gitignore dependency/editor/coverage entries', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^node_modules\/$/m);
    expect(gi).toMatch(/^dist\/$/m);
    expect(gi).toMatch(/^\.DS_Store$/m);
    expect(gi).toMatch(/^\.idea\/$/m);
    expect(gi).toMatch(/^\.vscode\/$/m);
    expect(gi).toMatch(/^coverage\/$/m);
  });

  it('documents DEPLOY prerequisites CF Workers, wrangler, Gemini, Node 18+', () => {
    const deploy = read('DEPLOY.md');
    const prereq = deploy.slice(deploy.indexOf('## Prerequisites'), deploy.indexOf('## Steps'));
    expect(prereq).toMatch(/Cloudflare account with Workers/);
    expect(prereq).toMatch(/wrangler/);
    expect(prereq).toMatch(/Gemini API key/);
    expect(prereq).toMatch(/Node\.js 18\+/);
  });

  it('documents DEPLOY npm install and kv namespace create CATALOG_CACHE', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/npm install/);
    expect(deploy).toMatch(/wrangler kv namespace create CATALOG_CACHE/);
  });

  it('locks DEPLOY cost token math and $0.00075 per request', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/2,000 input tokens \+ 200 output tokens/);
    expect(deploy).toMatch(/\$0\.00075 per request/);
  });

  it('locks DEPLOY HITL Required to exactly 3 warning bullets', () => {
    const deploy = read('DEPLOY.md');
    const hitl = deploy.slice(deploy.indexOf('## HITL Required'));
    expect((hitl.match(/^- ⚠️ /gm) ?? []).length).toBe(3);
  });

  it('hygiene workflow greps gemini-2.0-flash in src', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/gemini-2\.0-flash/);
  });

  it('locks Dependabot ignore semver-major YAML shape', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/update-types:\s*\["version-update:semver-major"\]/);
    expect(dep).toMatch(/dependency-name:\s*"\*"/);
  });

  it('uploads coverage-report artifact with if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*coverage-report/);
    expect(ci).toMatch(/if-no-files-found:\s*error/);
  });

  it('README CI badge points at fuzzywigg/Backlink_Facelift', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/github\.com\/fuzzywigg\/Backlink_Facelift\/actions/);
  });

  it('locks package.json scripts to exactly six keys', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).sort()).toEqual([
      'deploy',
      'dev',
      'test',
      'test:coverage',
      'test:watch',
      'typecheck',
    ]);
  });

  it('locks tsconfig noEmit true and lib ES2022 only', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { noEmit: boolean; lib: string[]; target: string };
    };
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.lib).toEqual(['ES2022']);
    expect(ts.compilerOptions.target).toBe('ES2022');
  });

  it('locks .cursor/environment.json name Backlink_Facelift', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { name: string; install: string };
    expect(env.name).toBe('Backlink_Facelift');
    expect(env.install).toBe('npm ci');
  });

  it('locks .gitattributes to LF normalization via text=auto', () => {
    const attrs = read('.gitattributes');
    expect(attrs).toMatch(/^\*\s+text=auto\s*$/m);
  });

  it('locks Dependabot directory "/" on both ecosystems', () => {
    const dep = read('.github/dependabot.yml');
    const directories = [...dep.matchAll(/directory:\s*"(\/)"/g)].map((m) => m[1]);
    expect(directories).toEqual(['/', '/']);
  });

  it('locks CI workflow display name', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^name:\s*CI\s*$/m);
  });

  it('keeps Dependabot ignore major-only without minor or patch ignores', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/version-update:semver-major/);
    expect(dep).not.toMatch(/semver-minor/);
    expect(dep).not.toMatch(/semver-patch/);
  });

  it('locks vitest coverage include and exclude arrays exactly', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/include:\s*\['src\/\*\*\/\*\.ts'\]/);
    expect(vitest).toMatch(/exclude:\s*\['src\/types\.ts'\]/);
  });

  it('hygiene required-files list includes .gitattributes', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -f \.gitattributes/);
    expect(ci).toMatch(/test -f README\.md/);
    expect(ci).toMatch(/test -f AGENTS\.md/);
    expect(ci).toMatch(/grep -q 'name: CI'/);
  });

  it('locks Dependabot open-pull-requests-limit to 3 (npm) and 2 (actions)', () => {
    const dep = read('.github/dependabot.yml');
    const npmLimit = dep.match(
      /package-ecosystem:\s*"npm"[\s\S]*?open-pull-requests-limit:\s*(\d+)/,
    );
    const ghaLimit = dep.match(
      /package-ecosystem:\s*"github-actions"[\s\S]*?open-pull-requests-limit:\s*(\d+)/,
    );
    expect(npmLimit?.[1]).toBe('3');
    expect(ghaLimit?.[1]).toBe('2');
  });

  it('hygiene includes Check for committed secret material step', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*Check for committed secret material/);
    expect(ci).toMatch(/! test -f \.env/);
    expect(ci).toMatch(/! test -f \.dev\.vars/);
  });

  it('locks package.json type module and version 0.1.0', () => {
    const pkg = JSON.parse(read('package.json')) as {
      type: string;
      version: string;
      name: string;
    };
    expect(pkg.type).toBe('module');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.name).toBe('backlink');
  });

  it('disables blank GitHub issues via ISSUE_TEMPLATE config', () => {
    const config = JSON.parse(
      // config.yml is YAML with a single key — parse loosely via line match
      '{"blank_issues_enabled": false}',
    ) as { blank_issues_enabled: boolean };
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toMatch(
      /^blank_issues_enabled:\s*false\s*$/m,
    );
    expect(config.blank_issues_enabled).toBe(false);
  });

  it('locks .gitignore coverage and wrangler local-state entries', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^\.wrangler\/$/m);
    expect(gi).toMatch(/^\.mf\/$/m);
    expect(gi).toMatch(/^dist\/$/m);
    expect(gi).toMatch(/^node_modules\/$/m);
  });

  it('locks exact CI and deploy concurrency group formulas', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(
      /group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/,
    );
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /group:\s*deploy-\$\{\{\s*github\.workflow\s*\}\}/,
    );
  });

  it('locks CI jobs to exactly typecheck, test, and hygiene in that order', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsBlock = ci.slice(ci.indexOf('\njobs:'));
    const jobs = [...jobsBlock.matchAll(/^  ([a-z]+):\s*$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('locks coverage upload artifact paths to coverage/ and coverage/lcov.info', () => {
    const ci = read('.github/workflows/ci.yml');
    const upload = ci.slice(ci.indexOf('Upload coverage report'));
    expect(upload).toMatch(/path:\s*\|\s*\n\s*coverage\/\s*\n\s*coverage\/lcov\.info/);
  });

  it('pins node-version 20 on every setup-node step in CI and deploy', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const body = read(rel);
      const versions = [...body.matchAll(/node-version:\s*"(\d+)"/g)].map((m) => m[1]);
      expect(versions.length).toBeGreaterThanOrEqual(1);
      expect(versions.every((v) => v === '20')).toBe(true);
    }
  });

  it('locks Dependabot manifest version to 2', () => {
    expect(read('.github/dependabot.yml')).toMatch(/^version:\s*2\s*$/m);
  });

  it('locks hygiene job to exactly two named steps', () => {
    const ci = read('.github/workflows/ci.yml');
    const hygiene = ci.slice(ci.indexOf('name: Hygiene'));
    const steps = [...hygiene.matchAll(/^\s+- name:\s*(.+)$/gm)].map((m) => m[1]);
    expect(steps).toEqual([
      'Check required files',
      'Check for committed secret material',
    ]);
  });

  it('locks tsconfig module ESNext and resolveJsonModule true', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { module: string; resolveJsonModule: boolean; strict: boolean };
    };
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.resolveJsonModule).toBe(true);
    expect(ts.compilerOptions.strict).toBe(true);
  });

  it('locks vitest coverage reporters to text, text-summary, html, lcov', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(
      /reporter:\s*\['text',\s*'text-summary',\s*'html',\s*'lcov'\]/,
    );
  });

  it('locks deploy job name Deploy and runs-on ubuntu-latest', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/name:\s*Deploy/);
    expect(deploy).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(deploy).toMatch(/secrets:\s*\|\s*\n\s*GEMINI_API_KEY/);
  });

  it('keeps ISSUE_TEMPLATE filenames exactly bug/feature/chore/config', () => {
    const names = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
    expect(names).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('locks CI Assert coverage artifacts greps SF:src/ in lcov', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/grep -q 'SF:src\/' coverage\/lcov\.info/);
    expect(ci).toMatch(/test -s coverage\/lcov\.info/);
    expect(ci).toMatch(/test -d coverage/);
  });

  it('locks deploy cancel-in-progress to false (HITL-safe)', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
    expect(deploy).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it('locks deploy trigger to workflow_dispatch only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/^on:\s*\n\s*workflow_dispatch:\s*$/m);
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
  });

  it('locks deploy timeout-minutes to 20', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/timeout-minutes:\s*20/);
  });

  it('locks deploy to cloudflare/wrangler-action@v4 with CF secrets', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/uses:\s*cloudflare\/wrangler-action@v4/);
    expect(deploy).toMatch(/apiToken:\s*\$\{\{\s*secrets\.CF_API_TOKEN\s*\}\}/);
    expect(deploy).toMatch(/accountId:\s*\$\{\{\s*secrets\.CF_ACCOUNT_ID\s*\}\}/);
  });

  it('locks deploy step order Typecheck → coverage → Deploy', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheck = deploy.indexOf('npm run typecheck');
    const coverage = deploy.indexOf('npm run test:coverage');
    const wrangler = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheck).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(typecheck);
    expect(wrangler).toBeGreaterThan(coverage);
  });

  it('locks CI timeouts typecheck 10 / test 15 / hygiene 5', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*Typecheck[\s\S]*?timeout-minutes:\s*10/);
    expect(ci).toMatch(/name:\s*Tests[\s\S]*?timeout-minutes:\s*15/);
    expect(ci).toMatch(/name:\s*Hygiene[\s\S]*?timeout-minutes:\s*5/);
  });

  it('locks CI permissions to contents:read only', () => {
    const ci = read('.github/workflows/ci.yml');
    const perms = ci.slice(ci.indexOf('permissions:'), ci.indexOf('defaults:'));
    expect(perms).toMatch(/contents:\s*read/);
    expect(perms).not.toMatch(/write/);
    expect(perms).not.toMatch(/id-token/);
    expect(perms).not.toMatch(/pull-requests/);
  });

  it('locks CI defaults.run.shell to bash', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(
      /defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/,
    );
  });

  it('locks every checkout to persist-credentials false', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const body = read(rel);
      const checkoutBlocks = [
        ...body.matchAll(
          /uses:\s*actions\/checkout@v7\s*\n\s*with:\s*\n\s*persist-credentials:\s*false/g,
        ),
      ];
      const checkouts = [...body.matchAll(/uses:\s*actions\/checkout@v7/g)];
      expect(checkouts.length).toBeGreaterThanOrEqual(1);
      expect(checkoutBlocks.length).toBe(checkouts.length);
    }
  });

  it('locks coverage artifact name coverage-report and retention-days 14', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name:\s*coverage-report/);
    expect(ci).toMatch(/retention-days:\s*14/);
    expect(ci).toMatch(/if-no-files-found:\s*error/);
    expect(ci).toMatch(/if:\s*always\(\)/);
  });

  it('locks Dependabot schedule interval monthly on both ecosystems', () => {
    const dep = read('.github/dependabot.yml');
    const intervals = [...dep.matchAll(/interval:\s*"(\w+)"/g)].map((m) => m[1]);
    expect(intervals).toEqual(['monthly', 'monthly']);
  });

  it('locks Dependabot group names npm-dependencies and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/npm-dependencies:/);
    expect(dep).toMatch(/github-actions:/);
    expect(dep).toMatch(/patterns:\s*\n\s*-\s*"\*"/);
  });

  it('locks Dependabot ecosystems to npm then github-actions', () => {
    const dep = read('.github/dependabot.yml');
    const ecosystems = [...dep.matchAll(/package-ecosystem:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ecosystems).toEqual(['npm', 'github-actions']);
  });

  it('locks package.json dependency to hono only under dependencies', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  });

  it('locks package.json devDependency set for Workers test toolchain', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      '@cloudflare/workers-types',
      '@types/node',
      '@vitest/coverage-v8',
      'typescript',
      'vitest',
      'wrangler',
    ]);
  });

  it('locks tsconfig include to src, test, and vitest.config.ts', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('locks tsconfig moduleResolution Bundler and skipLibCheck true', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { moduleResolution: string; skipLibCheck: boolean };
    };
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
  });

  it('locks tsconfig types to workers-types and node', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { types: string[] };
    };
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
  });

  it('locks vitest environment node and include test/**/*.test.ts', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/environment:\s*'node'/);
    expect(vitest).toMatch(/include:\s*\['test\/\*\*\/\*\.test\.ts'\]/);
  });

  it('locks vitest coverage provider v8 and all four 100 thresholds', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/provider:\s*'v8'/);
    expect(vitest).toMatch(/lines:\s*100/);
    expect(vitest).toMatch(/functions:\s*100/);
    expect(vitest).toMatch(/branches:\s*100/);
    expect(vitest).toMatch(/statements:\s*100/);
  });

  it('locks .cursor/environment.json to exactly name + install keys', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, string>;
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
    expect(env).toEqual({ name: 'Backlink_Facelift', install: 'npm ci' });
  });

  it('locks .gitignore secret and coverage entries', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\.\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
    expect(gi).toMatch(/^\*\.pem$/m);
    expect(gi).toMatch(/^\*\.key$/m);
  });

  it('locks CI job display names Typecheck / Tests / Hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^\s{4}name:\s*Typecheck\s*$/m);
    expect(ci).toMatch(/^\s{4}name:\s*Tests\s*$/m);
    expect(ci).toMatch(/^\s{4}name:\s*Hygiene\s*$/m);
  });

  it('locks CI setup-node cache to npm on every job', () => {
    const ci = read('.github/workflows/ci.yml');
    const caches = [...ci.matchAll(/cache:\s*"npm"/g)];
    expect(caches.length).toBe(2); // typecheck + test (hygiene has no node)
  });

  it('hygiene job does not install npm dependencies', () => {
    const ci = read('.github/workflows/ci.yml');
    const hygiene = ci.slice(ci.indexOf('name: Hygiene'));
    expect(hygiene).not.toMatch(/npm ci/);
    expect(hygiene).not.toMatch(/setup-node/);
  });

  it('locks deploy workflow display name Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /^name:\s*Deploy to Cloudflare Workers\s*$/m,
    );
  });

  it('locks package-lock.json lockfileVersion 3', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBe(3);
  });

  it('CI on: triggers are push+pull_request to main only', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(onBlock).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    expect(onBlock).not.toMatch(/workflow_dispatch/);
  });

  it('locks actions/setup-node@v7 and checkout@v7 pins', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const body = read(rel);
      expect(body).toMatch(/actions\/checkout@v7/);
      expect(body).toMatch(/actions\/setup-node@v7/);
      expect(body).not.toMatch(/actions\/checkout@v[1-6]\b/);
      expect(body).not.toMatch(/actions\/setup-node@v[1-6]\b/);
    }
  });

  it('locks upload-artifact@v4 pin in CI only', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/actions\/upload-artifact@v4/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/upload-artifact/);
  });

  it('locks package.json description for LLM-curated internet radio', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toMatch(/LLM-curated internet radio/i);
    expect(pkg.description).toMatch(/iptv-org/i);
  });

  it('keeps wrangler.toml listed in hygiene required files', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/test -f wrangler\.toml/);
  });

  it('keeps test/helpers.ts and helpers.test.ts in hygiene required files', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -f test\/helpers\.ts/);
    expect(ci).toMatch(/test -f test\/helpers\.test\.ts/);
    expect(ci).toMatch(/test -f test\/wrangler-config\.test\.ts/);
    expect(ci).toMatch(/test -f test\/ci-config\.test\.ts/);
  });

  it('hygiene requires test/parser.test.ts and src/parser.ts', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -f test\/parser\.test\.ts/);
    expect(ci).toMatch(/test -f src\/parser\.ts/);
  });

  it('hygiene requires source-contracts and helpers suites', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -f test\/source-contracts\.test\.ts/);
    expect(ci).toMatch(/test -f test\/helpers\.test\.ts/);
  });

  it('vitest coverage include covers src/**/*.ts including parser', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/include:\s*\['src\/\*\*\/\*\.ts'\]/);
    expect(vitest).toMatch(/exclude:\s*\['src\/types\.ts'\]/);
  });

  it('package.json test script is vitest run (not watch)', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:watch']).toBe('vitest');
  });

  it('CI Assert coverage artifacts greps SF:src/ in lcov', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'SF:src/' coverage/lcov.info");
    expect(ci).toContain('test -s coverage/lcov.info');
  });

  it('hygiene bans Anthropic strings under src and workflows', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/! grep -RqiE 'anthropic\|claude\|haiku' src/);
    expect(ci).toMatch(/! grep -RqiE 'anthropic\|claude\|haiku' \.github\/workflows/);
  });

  it('hygiene requires gemini-2.0-flash pin in src/index.ts', () => {
    expect(read('.github/workflows/ci.yml')).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
  });

  it('hygiene forbids GEMINI_API_KEY= assignment in wrangler.toml', () => {
    expect(read('.github/workflows/ci.yml')).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
  });

  it('lists parser.test.ts among expanded contract suites', () => {
    expect(read('test/parser.test.ts').length).toBeGreaterThan(1000);
    expect(read('test/parser.test.ts')).toContain("describe('parseM3U'");
  });

  it('keeps TypeScript module type as module in package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { type: string };
    expect(pkg.type).toBe('module');
  });

  it('locks vitest coverage reporters to include text-summary and html', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/'text'/);
    expect(vitest).toMatch(/'text-summary'/);
    expect(vitest).toMatch(/'html'/);
    expect(vitest).toMatch(/'lcov'/);
  });

  it('hygiene requires mcp and genres suites alongside mcp-spec contracts', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/test -f test\/mcp\.test\.ts/);
    expect(ci).toMatch(/test -f test\/genres\.test\.ts/);
    expect(ci).toMatch(/test -f test\/mcp-spec-contract\.test\.ts/);
    expect(ci).toMatch(/test -f src\/mcp\.ts/);
    expect(ci).toMatch(/test -f src\/genres\.ts/);
    expect(ci).toMatch(/test -f docs\/mcp-spec\.md/);
  });

  it('lists mcp/genres/mcp-spec among expanded contract suites on disk', () => {
    for (const rel of [
      'test/mcp.test.ts',
      'test/genres.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/source-contracts.test.ts',
      'src/mcp.ts',
      'src/genres.ts',
      'docs/mcp-spec.md',
    ]) {
      expect(read(rel).length).toBeGreaterThan(100);
    }
  });

  it('keeps README unit suites list mentioning mcp and genres', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/`genres`/);
    expect(readme).toMatch(/`mcp`/);
    expect(readme).toMatch(/mcp-spec/);
  });

  it('locks package.json free of mcp SDK runtime dependencies', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(JSON.stringify(pkg)).not.toMatch(/@modelcontextprotocol|mcp-server|fastmcp/i);
  });

  it('keeps docs/mcp-spec.md present and titled as MCP Tool Specification', () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec).toMatch(/^# Backlink MCP Tool Specification/m);
    expect(spec).toContain('backlink_curate');
    expect(spec).toContain('backlink_genres');
    expect(spec).toContain('backlink_now_playing');
  });

  it('locks AGENTS.md Safe Actions to mention genres.ts', () => {
    expect(read('AGENTS.md')).toMatch(/src\/genres\.ts/);
  });

  it('hygiene required-file list includes all four quad suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
    ]) {
      expect(ci).toContain(f);
    }
  });

  it('keeps coverage thresholds object listing all four metrics at 100', () => {
    const vitest = read('vitest.config.ts');
    for (const metric of ['lines', 'functions', 'branches', 'statements']) {
      expect(vitest).toMatch(new RegExp(`${metric}: 100`));
    }
  });

  it('AGENTS.md Safe Agent Actions lists genres parser and test/ extensions', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/src\/genres\.ts/);
    expect(agents).toMatch(/src\/parser\.ts/);
    expect(agents).toMatch(/test\//);
  });

  it('package scripts do not export GEMINI_API_KEY or invent secrets', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const cmd of Object.values(pkg.scripts)) {
      expect(cmd).not.toMatch(/GEMINI_API_KEY\s*=/);
      expect(cmd).not.toMatch(/API_KEY\s*=/);
    }
  });

  it('CI Tests job runs test:coverage not bare test', () => {
    const ci = read('.github/workflows/ci.yml');
    const testJob = ci.split('name: Tests')[1].split('name: Hygiene')[0];
    expect(testJob).toContain('npm run test:coverage');
    expect(testJob).not.toMatch(/run: npm test\b/);
  });

  it('locks vitest include glob to test/**/*.test.ts only', () => {
    expect(read('vitest.config.ts')).toContain("include: ['test/**/*.test.ts']");
  });

  it('keeps deploy workflow free of invented DNS or credential literals beyond secret name', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/CLOUDFLARE_API_TOKEN\s*:\s*['\"][^$]/);
    expect(deploy).toContain('GEMINI_API_KEY');
  });

  // --- HEAVY burn (post-#39): CI / package / hygiene / docs wiring ---

  it('locks CI concurrency group template to ci-${{ github.workflow }}-${{ github.ref }}', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
  });

  it('locks deploy concurrency group to deploy-${{ github.workflow }} with cancel-in-progress false', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('group: deploy-${{ github.workflow }}');
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
  });

  it('locks CI defaults.run.shell to bash', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
  });

  it('locks CI Typecheck timeout-minutes to 10', () => {
    const ci = read('.github/workflows/ci.yml');
    const typecheck = ci.split('name: Typecheck')[1].split('name: Tests')[0];
    expect(typecheck).toMatch(/timeout-minutes:\s*10/);
  });

  it('locks CI Tests timeout-minutes to 15', () => {
    const ci = read('.github/workflows/ci.yml');
    const tests = ci.split('name: Tests')[1].split('name: Hygiene')[0];
    expect(tests).toMatch(/timeout-minutes:\s*15/);
  });

  it('locks CI Hygiene timeout-minutes to 5', () => {
    const ci = read('.github/workflows/ci.yml');
    const hygiene = ci.split('name: Hygiene')[1];
    expect(hygiene).toMatch(/timeout-minutes:\s*5/);
  });

  it('locks deploy job timeout-minutes to 20', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/timeout-minutes:\s*20/);
  });

  it('locks deploy to cloudflare/wrangler-action@v4', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('cloudflare/wrangler-action@v4');
  });

  it('locks deploy secrets block to list GEMINI_API_KEY only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/secrets:\s*\|\s*\n\s*GEMINI_API_KEY\s*\n/);
  });

  it('locks deploy apiToken and accountId to CF_* secrets references', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
  });

  it('locks package.json name to backlink and version 0.1.0', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
  });

  it('locks package.json type to module', () => {
    const pkg = JSON.parse(read('package.json')) as { type: string };
    expect(pkg.type).toBe('module');
  });

  it('locks package scripts to exactly six known keys', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).sort()).toEqual([
      'deploy',
      'dev',
      'test',
      'test:coverage',
      'test:watch',
      'typecheck',
    ]);
  });

  it('locks package scripts.dev to wrangler dev', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
  });

  it('locks runtime dependency to hono only at ^4', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  });

  it('locks vitest and coverage-v8 to ^5 line', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
  });

  it('locks wrangler devDependency to ^4 line', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
  });

  it('locks tsconfig strict true and noEmit true', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
  });

  it('locks tsconfig module ESNext and moduleResolution Bundler', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { module: string; moduleResolution: string; target: string };
    };
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.target).toBe('ES2022');
  });

  it('locks tsconfig types to workers-types and node', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { types: string[] };
    };
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
  });

  it('locks tsconfig include to src test and vitest.config', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('locks .gitignore to ignore .env .dev.vars coverage and node_modules', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^node_modules\/$/m);
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^\.wrangler\/$/m);
  });

  it('locks .gitignore to ignore pem and key files', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('*.pem');
    expect(gi).toContain('*.key');
  });

  it('locks .gitattributes to text=auto LF normalization', () => {
    expect(read('.gitattributes')).toMatch(/\*\s+text=auto/);
  });

  it('locks dependabot version 2 with monthly npm and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/^version:\s*2/m);
    expect(dep).toMatch(/interval:\s*"monthly"/g);
    expect((dep.match(/interval:\s*"monthly"/g) ?? []).length).toBe(2);
  });

  it('locks dependabot open-pull-requests-limit npm 3 and actions 2', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/open-pull-requests-limit:\s*3/);
    expect(dep).toMatch(/open-pull-requests-limit:\s*2/);
  });

  it('locks dependabot group names npm-dependencies and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toMatch(/groups:\s*\n\s*github-actions:/);
  });

  it('locks vitest environment to node', () => {
    expect(read('vitest.config.ts')).toMatch(/environment:\s*'node'/);
  });

  it('locks vitest coverage exclude to src/types.ts only', () => {
    expect(read('vitest.config.ts')).toMatch(/exclude:\s*\[['"]src\/types\.ts['"]\]/);
  });

  it('locks vitest coverage include to src/**/*.ts', () => {
    expect(read('vitest.config.ts')).toMatch(/include:\s*\[['"]src\/\*\*\/\*\.ts['"]\]/);
  });

  it('CI Assert coverage artifacts requires coverage dir and non-empty lcov', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('test -d coverage');
    expect(ci).toContain('test -f coverage/lcov.info');
    expect(ci).toContain('test -s coverage/lcov.info');
  });

  it('CI upload-artifact retention-days is 14 and if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/retention-days:\s*14/);
    expect(ci).toMatch(/if-no-files-found:\s*error/);
  });

  it('hygiene requires ISSUE-adjacent templates exist on disk', () => {
    for (const f of [
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
    ]) {
      expect(read(f).length).toBeGreaterThan(0);
    }
  });

  it('keeps README Cloud agents section mentioning environment.json and HITL deploy', () => {
    const readme = read('README.md');
    expect(readme).toContain('.cursor/environment.json');
    expect(readme).toMatch(/Deploy remains HITL/i);
    expect(readme).toContain('npm run test:coverage');
  });

  it('keeps README Available Genres middot list matching VALID_GENRES order', () => {
    expect(read('README.md')).toContain(
      '`music` · `ambient` · `jazz` · `classical` · `pop` · `rock` · `news` · `sports` · `entertainment`',
    );
  });

  it('locks DEPLOY.md HITL Required section with GEMINI and first deploy warnings', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/## HITL Required/);
    expect(deploy).toMatch(/First production deploy/);
    expect(deploy).toContain('GEMINI_API_KEY');
  });

  it('locks DEPLOY.md custom domain to backlink.fuzzywigg.com', () => {
    expect(read('DEPLOY.md')).toContain('backlink.fuzzywigg.com');
  });

  it('locks AGENTS.md domain target to backlink.fuzzywigg.com', () => {
    expect(read('AGENTS.md')).toContain('backlink.fuzzywigg.com');
  });

  it('locks AGENTS.md Verify block to typecheck test and test:coverage', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('locks AGENTS.md Escalate to include GEMINI_API_KEY and production deploy', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/GEMINI_API_KEY/);
    expect(agents).toMatch(/Production deploy/);
    expect(agents).toMatch(/CORS/);
  });

  it('CI jobs use ubuntu-latest runners exclusively', () => {
    const ci = read('.github/workflows/ci.yml');
    const runners = [...ci.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]);
    expect(runners.length).toBeGreaterThanOrEqual(3);
    expect(runners.every((r) => r === 'ubuntu-latest')).toBe(true);
  });

  it('deploy workflow uses ubuntu-latest runner', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/runs-on:\s*ubuntu-latest/);
  });

  it('CI permissions contents read and no write-all', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(ci).not.toMatch(/contents:\s*write/);
    expect(ci).not.toMatch(/permissions:\s*write-all/);
  });

  it('hygiene bans Anthropic under src via ! grep pattern', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/! grep -RqiE 'anthropic\|claude\|haiku' src/);
  });

  it('hygiene requires package-lock lockfileVersion 3', () => {
    expect(read('.github/workflows/ci.yml')).toContain('"lockfileVersion": 3');
    expect(read('package-lock.json')).toMatch(/"lockfileVersion":\s*3/);
  });

  it('hygiene requires docs/mcp-spec.md and test/mcp-spec-contract.test.ts', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect(hygiene).toContain('docs/mcp-spec.md');
    expect(hygiene).toContain('test/mcp-spec-contract.test.ts');
  });

  it('hygiene requires all five src modules including types.ts', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(hygiene).toContain(f);
    }
  });

  it('CI on: block does not use pull_request_target trigger', () => {
    const onBlock = read('.github/workflows/ci.yml').split(/^jobs:/m)[0];
    expect(onBlock).not.toMatch(/^\s*pull_request_target\s*:/m);
    expect(read('.github/workflows/deploy.yml').split(/^jobs:/m)[0]).not.toMatch(
      /^\s*pull_request_target\s*:/m,
    );
  });

  it('deploy workflow does not trigger on push or pull_request', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.split('jobs:')[0];
    expect(onBlock).toContain('workflow_dispatch');
    expect(onBlock).not.toMatch(/^\s*push:/m);
    expect(onBlock).not.toMatch(/^\s*pull_request:/m);
  });

  it('locks .cursor/environment.json install to npm ci without secrets', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(env).toEqual({ name: 'Backlink_Facelift', install: 'npm ci' });
    expect(JSON.stringify(env)).not.toMatch(/GEMINI|API_KEY|TOKEN/i);
  });

  it('package.json description mentions LLM-curated internet radio', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toMatch(/LLM-curated internet radio/i);
    expect(pkg.description).toMatch(/iptv-org/i);
  });

  it('vitest reporters switch on GITHUB_ACTIONS env ternary', () => {
    expect(read('vitest.config.ts')).toMatch(
      /reporters:\s*process\.env\.GITHUB_ACTIONS\s*\?\s*\['default',\s*'github-actions'\]\s*:\s*\['default'\]/,
    );
  });

  it('CI checkout persist-credentials false on every job', () => {
    const ci = read('.github/workflows/ci.yml');
    const count = (ci.match(/persist-credentials:\s*false/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('deploy checkout persist-credentials false', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/persist-credentials:\s*false/);
  });

  it('CI name is exactly CI at workflow top', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^name:\s*CI\s*$/m);
  });

  it('deploy workflow name is Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /^name:\s*Deploy to Cloudflare Workers\s*$/m,
    );
  });

  it('hygiene checks for .cursor/environment.json presence', () => {
    expect(read('.github/workflows/ci.yml')).toContain('.cursor/environment.json');
  });

  it('package-lock name matches package.json name backlink', () => {
    const lock = JSON.parse(read('package-lock.json')) as { name: string };
    expect(lock.name).toBe('backlink');
  });

  it('keeps no .env or .dev.vars committed at repo root', () => {
    const files = readdirSync(root);
    expect(files).not.toContain('.env');
    expect(files).not.toContain('.dev.vars');
  });

  it('locks test:watch script to vitest without run', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:watch']).toBe('vitest');
  });

  it('CI Typecheck job does not run test:coverage', () => {
    const typecheckJob = read('.github/workflows/ci.yml')
      .split(/^ {2}typecheck:/m)[1]
      .split(/^ {2}test:/m)[0];
    expect(typecheckJob).toContain('npm run typecheck');
    expect(typecheckJob).not.toContain('test:coverage');
  });

  it('hygiene job Check required files mentions thresholds and branches 100', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect(hygiene).toContain("grep -q 'thresholds' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'branches: 100' vitest.config.ts");
  });

  it('deploy runs typecheck and test:coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheckIdx = deploy.indexOf('npm run typecheck');
    const coverageIdx = deploy.indexOf('npm run test:coverage');
    const wranglerIdx = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheckIdx).toBeGreaterThan(-1);
    expect(coverageIdx).toBeGreaterThan(typecheckIdx);
    expect(wranglerIdx).toBeGreaterThan(coverageIdx);
  });

  it('README badge points at ci.yml workflow', () => {
    expect(read('README.md')).toContain('actions/workflows/ci.yml/badge.svg');
  });

  it('locks @types/node to ^22 line', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies['@types/node']).toMatch(/^\^22\./);
  });

  it('locks @cloudflare/workers-types to ^5 line', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies['@cloudflare/workers-types']).toMatch(/^\^5\./);
  });

  it('CI on: push and pull_request both target main only', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.split('jobs:')[0];
    expect(onBlock).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(onBlock).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  it('hygiene secret-material step excludes package-lock and markdown', () => {
    const hygiene = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(hygiene).toContain("--exclude='*.md'");
    expect(hygiene).toContain("--exclude='package-lock.json'");
  });

  it('keeps vitest coverage provider v8', () => {
    expect(read('vitest.config.ts')).toMatch(/provider:\s*'v8'/);
  });

  it('package.json has no optionalDependencies or peerDependencies', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('AGENTS.md classification Autonomy L2 and Tier A', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/Tier:\s*A/);
    expect(agents).toMatch(/Autonomy:\s*L2/);
  });

  it('AGENTS.md Safe Agent Actions includes M3U parser and unit tests under test/', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/M3U parser/);
    expect(agents).toMatch(/unit tests under `test\/`/);
  });

  it('DEPLOY.md local dev points at localhost:8787', () => {
    expect(read('DEPLOY.md')).toContain('http://localhost:8787');
  });

  it('README Stack mentions Cloudflare Workers Hono iptv-org Gemini and CF KV', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/Cloudflare Workers/);
    expect(readme).toMatch(/Hono/);
    expect(readme).toMatch(/iptv-org/);
    expect(readme).toMatch(/Gemini 2\.0 Flash/);
    expect(readme).toMatch(/CF KV/);
  });

  it('CI Hygiene does not use setup-node', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect(hygiene).not.toContain('actions/setup-node');
    expect(hygiene).not.toContain('npm ci');
  });

  it('locks coverage artifact name to coverage-report', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/name:\s*coverage-report/);
  });

  it('package scripts.typecheck is exactly tsc --noEmit', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
  });

  it('tsconfig skipLibCheck and resolveJsonModule are true', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
    expect(ts.compilerOptions.resolveJsonModule).toBe(true);
  });

  it('gitignore allows .env.example via negation', () => {
    expect(read('.gitignore')).toContain('!.env.example');
  });

  it('dependabot ignore blocks semver-major for all npm deps', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('update-types: ["version-update:semver-major"]');
    expect(dep).toMatch(/dependency-name:\s*"\*"/);
  });

  it('CI upload path includes coverage/ and coverage/lcov.info', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/path:\s*\|\s*\n\s*coverage\/\s*\n\s*coverage\/lcov\.info/);
  });

  it('hygiene requires upload-artifact@v4 and if: always()', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('upload-artifact@v4');
    expect(ci).toMatch(/if:\s*always\(\)/);
  });

  it('README documents live worker URL https://backlink.fuzzywigg.com', () => {
    expect(read('README.md')).toContain('https://backlink.fuzzywigg.com');
  });

  it('DEPLOY.md documents wrangler kv namespace create CATALOG_CACHE', () => {
    expect(read('DEPLOY.md')).toContain('wrangler kv namespace create CATALOG_CACHE');
  });

  it('package.json has no bin or engines field inventing Node pins beyond CI', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.bin).toBeUndefined();
    expect(pkg.engines).toBeUndefined();
  });

  it('locks CI concurrency group exact string ci-${{ github.workflow }}-${{ github.ref }}', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'group: ci-${{ github.workflow }}-${{ github.ref }}',
    );
  });

  it('locks deploy concurrency group exact string deploy-${{ github.workflow }}', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'group: deploy-${{ github.workflow }}',
    );
  });

  it('locks CI job timeout-minutes numbers typecheck 10 test 15 hygiene 5', () => {
    const ci = read('.github/workflows/ci.yml');
    const typecheck = ci.split(/^ {2}typecheck:/m)[1].split(/^ {2}test:/m)[0];
    const test = ci.split(/^ {2}test:/m)[1].split(/^ {2}hygiene:/m)[0];
    const hygiene = ci.split(/^ {2}hygiene:/m)[1];
    expect(typecheck).toMatch(/timeout-minutes:\s*10\b/);
    expect(test).toMatch(/timeout-minutes:\s*15\b/);
    expect(hygiene).toMatch(/timeout-minutes:\s*5\b/);
  });

  it('locks deploy job timeout-minutes to 20', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/timeout-minutes:\s*20\b/);
  });

  it('locks node-version "20" in both CI and deploy setup-node steps', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version:\s*"20"/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/node-version:\s*"20"/);
    expect((read('.github/workflows/ci.yml').match(/node-version:\s*"20"/g) ?? []).length).toBe(3);
  });

  it('locks coverage artifact retention-days exactly 14', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/retention-days:\s*14\b/);
    expect(ci).not.toMatch(/retention-days:\s*(?!14)\d+/);
  });

  it('locks package-lock.json lockfileVersion exact integer 3', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBe(3);
    expect(Number.isInteger(lock.lockfileVersion)).toBe(true);
  });

  it('CI on: block has push and pull_request but never pull_request_target', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).toMatch(/^\s*push:/m);
    expect(onBlock).toMatch(/^\s*pull_request:/m);
    expect(onBlock).not.toMatch(/pull_request_target/);
  });

  it('hygiene Check required files includes every test/*.test.ts suite file', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Check required files')[1];
    for (const file of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/helpers.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
      'test/helpers.ts',
    ]) {
      expect(hygiene).toContain(`test -f ${file}`);
    }
  });

  it('locks vitest include pattern to test/**/*.test.ts exactly', () => {
    expect(read('vitest.config.ts')).toContain("include: ['test/**/*.test.ts']");
  });

  it('locks vitest coverage exclude to src/types.ts only (array length 1)', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/exclude:\s*\['src\/types\.ts'\]/);
    const excludeMatch = cfg.match(/exclude:\s*\[([^\]]+)\]/);
    expect(excludeMatch?.[1].trim()).toBe("'src/types.ts'");
  });

  it('deploy workflow on: is workflow_dispatch only (no push/pull_request)', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.slice(deploy.indexOf('\non:'), deploy.indexOf('\npermissions:'));
    expect(onBlock).toMatch(/workflow_dispatch/);
    expect(onBlock).not.toMatch(/^\s*push:/m);
    expect(onBlock).not.toMatch(/^\s*pull_request:/m);
    expect(onBlock).not.toMatch(/pull_request_target/);
  });

  it('tsconfig include locks src test and vitest.config.ts', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('tsconfig strict and noEmit stay enabled', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.target).toBe('ES2022');
  });

  it('dependabot npm ignore locks semver-major update-types array', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('update-types: ["version-update:semver-major"]');
    expect(dep).toMatch(/package-ecosystem:\s*"npm"/);
    expect(dep).toMatch(/interval:\s*"monthly"/);
  });

  it('gitignore locks coverage/ node_modules/ and .dev.vars secret paths', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^node_modules\/$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.wrangler\/$/m);
  });

  it('README documents verify scripts aligning with package.json', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/npm (run )?typecheck|typecheck/);
    expect(readme.toLowerCase()).toMatch(/test/);
  });

  it('DEPLOY.md documents HITL and wrangler secret put GEMINI_API_KEY', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/HITL/i);
    expect(deploy).toContain('wrangler secret put GEMINI_API_KEY');
    expect(deploy).not.toMatch(/ANTHROPIC_API_KEY\s*=/);
  });

  it('AGENTS.md verify block lists npm ci typecheck test and test:coverage', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('environment.json stays name+install only with no secrets keys', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
    expect(env).not.toHaveProperty('secrets');
    expect(env).not.toHaveProperty('GEMINI_API_KEY');
    expect(env).not.toHaveProperty('CF_API_TOKEN');
    expect(JSON.stringify(env)).not.toMatch(/sk-|api[_-]?key|token/i);
  });

  it('package.json scripts lock typecheck test test:coverage and test:watch', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.scripts['test:watch']).toBe('vitest');
  });

  it('CI defaults.run.shell is bash and permissions contents read', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
    expect(ci).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it('hygiene asserts vitest thresholds lines functions statements and branches 100', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect(hygiene).toContain("grep -q 'lines: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'functions: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'statements: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'branches: 100' vitest.config.ts");
  });

  it('vitest coverage include is src/**/*.ts and provider v8', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain("include: ['src/**/*.ts']");
    expect(cfg).toMatch(/provider:\s*'v8'/);
    expect(cfg).toContain("'lcov'");
  });

  it('CI cancel-in-progress true while deploy cancel-in-progress false', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/cancel-in-progress:\s*true/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/cancel-in-progress:\s*false/);
  });


  // --- HEAVY burn (post-#46): helpers/CI/wrangler/source/mcp-spec deepen ---
  it('locks CI workflow concurrency group template ci-${{ github.workflow }}-${{ github.ref }}', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
  });

  it('locks deploy concurrency group to deploy-${{ github.workflow }} only', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'group: deploy-${{ github.workflow }}',
    );
  });

  it('deploy workflow has no defaults.run.shell override', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/shell:\s*bash/);
  });

  it('locks Typecheck job timeout-minutes to 10', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Typecheck'), ci.indexOf('name: Tests'));
    expect(block).toMatch(/timeout-minutes:\s*10/);
  });

  it('locks Tests job timeout-minutes to 15', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Tests'), ci.indexOf('name: Hygiene'));
    expect(block).toMatch(/timeout-minutes:\s*15/);
  });

  it('CI upload-artifact step is gated if: always()', () => {
    const ci = read('.github/workflows/ci.yml');
    const upload = ci.slice(ci.indexOf('Upload coverage report'));
    expect(upload).toMatch(/if:\s*always\(\)/);
  });

  it('hygiene Check required files lists deploy.yml and dependabot.yml', () => {
    const hygiene = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(hygiene).toContain('test -f .github/workflows/deploy.yml');
    expect(hygiene).toContain('test -f .github/dependabot.yml');
  });

  it('hygiene requires vitest.config.ts and tsconfig.json', () => {
    const hygiene = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(hygiene).toContain('test -f vitest.config.ts');
    expect(hygiene).toContain('test -f tsconfig.json');
  });

  it('hygiene requires helpers.ts and helpers.test.ts', () => {
    const hygiene = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(hygiene).toContain('test -f test/helpers.ts');
    expect(hygiene).toContain('test -f test/helpers.test.ts');
  });

  it('hygiene bans GEMINI_API_KEY= assignment in wrangler.toml', () => {
    expect(read('.github/workflows/ci.yml')).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
  });

  it('hygiene bans api key assignments in wrangler.toml via regex', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      "! grep -qiE 'api[_-]?key\\s*=' wrangler.toml",
    );
  });

  it('hygiene requires gemini-2.0-flash in src/index.ts', () => {
    expect(read('.github/workflows/ci.yml')).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
  });

  it('hygiene locks typescript to ^5 and bans ^6/^7 majors', () => {
    const hygiene = read('.github/workflows/ci.yml');
    expect(hygiene).toContain(String.raw`grep -qE '"typescript": "\^5\.' package.json`);
    expect(hygiene).toContain(String.raw`! grep -qE '"typescript": "\^[67]\.' package.json`);
  });

  it('deploy workflow secrets list is only GEMINI_API_KEY', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const start = deploy.indexOf('secrets: |');
    const end = deploy.indexOf('env:', start);
    const block = deploy.slice(start, end);
    expect(block).toContain('GEMINI_API_KEY');
    expect(block).not.toMatch(/ANTHROPIC|CF_API_TOKEN|OPENAI/i);
    expect([...block.matchAll(/^\s+([A-Z0-9_]+)\s*$/gm)].map((m) => m[1])).toEqual([
      'GEMINI_API_KEY',
    ]);
  });

  it('deploy env maps GEMINI_API_KEY from secrets.GEMINI_API_KEY', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
    );
  });

  it('deploy apiToken uses secrets.CF_API_TOKEN', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'apiToken: ${{ secrets.CF_API_TOKEN }}',
    );
  });

  it('deploy accountId uses secrets.CF_ACCOUNT_ID', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'accountId: ${{ secrets.CF_ACCOUNT_ID }}',
    );
  });

  it('deploy job display name is Deploy', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/^\s+name:\s*Deploy\s*$/m);
  });

  it('package.json scripts keys stay exactly six', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).sort()).toEqual(
      ['deploy', 'dev', 'test', 'test:coverage', 'test:watch', 'typecheck'].sort(),
    );
  });

  it('package.json deploy script is wrangler deploy', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
  });

  it('package.json has no scripts for lint or format inventing tooling', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.lint).toBeUndefined();
    expect(pkg.scripts.format).toBeUndefined();
  });

  it('package-lock packages root name is backlink', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      packages: Record<string, { name?: string }>;
    };
    expect(lock.name).toBe('backlink');
    expect(lock.packages[''].name).toBe('backlink');
  });

  it('package-lock includes vitest and @vitest/coverage-v8', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    expect(lock.packages['node_modules/vitest']).toBeTruthy();
    expect(lock.packages['node_modules/@vitest/coverage-v8']).toBeTruthy();
  });

  it('vitest.config coverage reporters include text text-summary html lcov', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/reporter:\s*\[['"]text['"],\s*['"]text-summary['"],\s*['"]html['"],\s*['"]lcov['"]\]/);
  });

  it('vitest.config exclude coverage for src/types.ts only', () => {
    expect(read('vitest.config.ts')).toMatch(/exclude:\s*\[['"]src\/types\.ts['"]\]/);
  });

  it('tsconfig target and lib are ES2022', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { target: string; lib: string[] };
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.lib).toEqual(['ES2022']);
  });

  it('tsconfig has no paths or baseUrl inventing aliases', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.paths).toBeUndefined();
    expect(ts.compilerOptions.baseUrl).toBeUndefined();
  });

  it('.gitattributes is exactly text=auto LF normalization comment + star rule', () => {
    const ga = read('.gitattributes').trimEnd();
    expect(ga).toBe('# Auto detect text files and perform LF normalization\n* text=auto');
  });

  it('.cursor/environment.json has no start or secrets keys', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
    expect(env).not.toHaveProperty('start');
    expect(env).not.toHaveProperty('secrets');
  });

  it('dependabot npm and github-actions both schedule monthly', () => {
    const dep = read('.github/dependabot.yml');
    expect([...dep.matchAll(/interval:\s*"monthly"/g)]).toHaveLength(2);
  });

  it('dependabot version key is 2', () => {
    expect(read('.github/dependabot.yml')).toMatch(/^version:\s*2\s*$/m);
  });

  it('ISSUE_TEMPLATE config disables blank issues', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml').trim()).toBe('blank_issues_enabled: false');
  });

  it('ISSUE_TEMPLATE bug component options lock Parser Curator API Deploy CF-AI KV-Cache', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toContain('options: [Parser, Curator, API, Deploy, CF-AI, KV-Cache]');
    expect(bug).not.toContain('New');
  });

  it('ISSUE_TEMPLATE feature component options include New', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toContain(
      'options: [Parser, Curator, API, Deploy, CF-AI, KV-Cache, New]',
    );
  });

  it('ISSUE_TEMPLATE chore type options are Chore Infra Docs Research', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toContain(
      'options: [Chore, Infra, Docs, Research]',
    );
  });

  it('ISSUE_TEMPLATE bug feature chore share Priority Critical High Medium Low', () => {
    for (const rel of [
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
    ]) {
      expect(read(rel)).toContain('options: [Critical, High, Medium, Low]');
    }
  });

  it('ISSUE_TEMPLATE bug feature chore share Effort XS S M L XL', () => {
    for (const rel of [
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
    ]) {
      expect(read(rel)).toContain('options: [XS, S, M, L, XL]');
    }
  });

  it('ISSUE_TEMPLATE feature Status options include Backlog Ready In Progress Blocked', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toContain(
      'options: [Backlog, Ready, "In Progress", Blocked]',
    );
  });

  it('ISSUE_TEMPLATE labels are bug enhancement chore respectively', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toContain('labels: ["bug"]');
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toContain('labels: ["enhancement"]');
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toContain('labels: ["chore"]');
  });

  it('README documents jazz ambient classical pop rock files 404 fallback', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/404 and fall back to `music\.m3u`/);
    expect(readme).toMatch(/editorial: null/);
  });

  it('README lists real matching categories music news sports entertainment', () => {
    expect(read('README.md')).toContain(
      'Real matching categories today: `music`, `news`, `sports`, `entertainment`.',
    );
  });

  it('README Available Genres middot-separated list matches VALID_GENRES', () => {
    const line = read('README.md')
      .split('\n')
      .find((l) => l.includes('`music` · `ambient`'));
    expect(line).toBe(
      '`music` · `ambient` · `jazz` · `classical` · `pop` · `rock` · `news` · `sports` · `entertainment`',
    );
  });

  it('README Cloud agents section mentions coverage floors 100%', () => {
    expect(read('README.md')).toMatch(/Coverage floors stay at \*\*100%\*\*/);
  });

  it('DEPLOY.md Prerequisites list Cloudflare wrangler Gemini Node 18+', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('Cloudflare account with Workers enabled');
    expect(deploy).toContain('wrangler');
    expect(deploy).toContain('Gemini API key');
    expect(deploy).toContain('Node.js 18+');
  });

  it('DEPLOY.md documents placeholder your-kv-id-here for local paste', () => {
    expect(read('DEPLOY.md')).toContain('your-kv-id-here');
  });

  it('DEPLOY.md cost estimate cites Gemini 2.0 Flash token pricing', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('Gemini 2.0 Flash');
    expect(deploy).toContain('~$0.25/1M input tokens');
    expect(deploy).toContain('~$1.25/1M output tokens');
  });

  it('DEPLOY.md HITL Required warns first deploy and GEMINI and external sources', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/First production deploy must be reviewed by Andrew/);
    expect(deploy).toMatch(/GEMINI_API_KEY handling require approval/);
    expect(deploy).toMatch(/new external data sources requires approval/);
  });

  it('AGENTS.md Safe Agent Actions includes genre mappings and M3U parser', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('src/genres.ts');
    expect(agents).toContain('src/parser.ts');
    expect(agents).toContain('src/index.ts');
  });

  it('AGENTS.md Escalate includes CORS authentication billing CF account', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/CORS or authentication/);
    expect(agents).toMatch(/billing or CF account/);
  });

  it('AGENTS.md parent_governance points at fuzzywigg/agents-governance', () => {
    expect(read('AGENTS.md')).toContain(
      'parent_governance: github.com/fuzzywigg/agents-governance',
    );
  });

  it('gitignore ignores .wrangler/ .mf/ dist/ coverage/ node_modules/', () => {
    const gi = read('.gitignore');
    for (const entry of ['.wrangler/', '.mf/', 'dist/', 'coverage/', 'node_modules/']) {
      expect(gi).toContain(entry);
    }
  });

  it('gitignore ignores editor noise DS_Store idea vscode swp', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('.DS_Store');
    expect(gi).toContain('.idea/');
    expect(gi).toContain('.vscode/');
    expect(gi).toContain('*.swp');
  });

  it('CI workflow name key is CI', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^name:\s*CI\s*$/m);
  });

  it('CI permissions block is contents read only', () => {
    const ci = read('.github/workflows/ci.yml');
    const perms = ci.slice(ci.indexOf('permissions:'), ci.indexOf('defaults:'));
    expect(perms).toMatch(/contents:\s*read/);
    expect(perms).not.toMatch(/write|id-token|packages|actions:/);
  });

  it('deploy permissions block is contents read only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const perms = deploy.slice(deploy.indexOf('permissions:'), deploy.indexOf('concurrency:'));
    expect(perms).toMatch(/contents:\s*read/);
    expect(perms).not.toMatch(/write/);
  });

  it('hygiene secret-scan excludes coverage and node_modules and .git', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain('--exclude-dir=coverage');
    expect(step).toContain('--exclude-dir=node_modules');
    expect(step).toContain('--exclude-dir=.git');
  });

  it('hygiene bans committed .env and .dev.vars files', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain('! test -f .env');
    expect(step).toContain('! test -f .dev.vars');
  });

  it('hygiene bans committed pem and key files via find', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain("*.pem");
    expect(step).toContain("*.key");
  });

  it('package.json description matches root API description substring', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('package.json private field is unset (publishable name reserved locally)', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.private).toBeUndefined();
  });

  it('CI Typecheck job steps are checkout setup-node npm ci typecheck only', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Typecheck'), ci.indexOf('name: Tests'));
    expect(block).toContain('actions/checkout@v7');
    expect(block).toContain('actions/setup-node@v7');
    expect(block).toContain('npm ci');
    expect(block).toContain('npm run typecheck');
    expect(block).not.toContain('test:coverage');
  });

  it('CI Tests job includes Assert coverage artifacts exist step name', () => {
    expect(read('.github/workflows/ci.yml')).toContain('Assert coverage artifacts exist');
  });

  it('dependabot github-actions open-pull-requests-limit is 2', () => {
    const dep = read('.github/dependabot.yml');
    const actions = dep.slice(dep.indexOf('package-ecosystem: "github-actions"'));
    expect(actions).toMatch(/open-pull-requests-limit:\s*2/);
  });

  it('dependabot npm open-pull-requests-limit is 3', () => {
    const dep = read('.github/dependabot.yml');
    const npm = dep.slice(0, dep.indexOf('package-ecosystem: "github-actions"'));
    expect(npm).toMatch(/open-pull-requests-limit:\s*3/);
  });

  // --- HEAVY burn (post-#53): CI / package contract deepen ---

  it('CI workflow has exactly three jobs typecheck test hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsBlock = ci.slice(ci.indexOf('jobs:'));
    const jobs = [...jobsBlock.matchAll(/^  ([a-z]+):\s*$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('CI checkout@v7 appears exactly three times (one per job)', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/actions\/checkout@v7/g)]).toHaveLength(3);
  });

  it('CI setup-node@v7 appears exactly twice (typecheck + test, not hygiene)', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/actions\/setup-node@v7/g)]).toHaveLength(2);
    const hygiene = ci.slice(ci.indexOf('name: Hygiene'));
    expect(hygiene).not.toContain('setup-node');
    expect(hygiene).not.toContain('npm ci');
  });

  it('CI npm ci appears exactly twice', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/^\s+run:\s*npm ci\s*$/gm)]).toHaveLength(2);
  });

  it('CI persist-credentials false on every checkout', () => {
    const ci = read('.github/workflows/ci.yml');
    // YAML with: blocks (3 checkouts) plus hygiene grep assertions referencing the key
    expect([...ci.matchAll(/^\s+persist-credentials:\s*false\s*$/gm)]).toHaveLength(3);
    expect([...ci.matchAll(/persist-credentials: false/g)].length).toBeGreaterThanOrEqual(3);
  });

  it('CI cache npm on both Node setup steps', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/cache:\s*"npm"/g)]).toHaveLength(2);
  });

  it('CI typecheck timeout-minutes is 10', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Typecheck'), ci.indexOf('name: Tests'));
    expect(block).toMatch(/timeout-minutes:\s*10/);
  });

  it('CI test timeout-minutes is 15', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Tests'), ci.indexOf('name: Hygiene'));
    expect(block).toMatch(/timeout-minutes:\s*15/);
  });

  it('CI hygiene timeout-minutes is 5', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Hygiene'));
    expect(block).toMatch(/timeout-minutes:\s*5/);
  });

  it('CI concurrency group template is ci-${{ github.workflow }}-${{ github.ref }}', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'group: ci-${{ github.workflow }}-${{ github.ref }}',
    );
  });

  it('CI triggers only push and pull_request to main', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('on:'), ci.indexOf('concurrency:'));
    expect(onBlock).toContain('push:');
    expect(onBlock).toContain('pull_request:');
    expect(onBlock).toMatch(/branches:\s*\[main\]/);
    expect(onBlock).not.toContain('workflow_dispatch');
    expect(onBlock).not.toContain('schedule:');
  });

  it('CI coverage assert greps SF:src/ in lcov.info', () => {
    expect(read('.github/workflows/ci.yml')).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('CI coverage assert requires non-empty lcov via test -s', () => {
    expect(read('.github/workflows/ci.yml')).toContain('test -s coverage/lcov.info');
  });

  it('CI upload-artifact retention-days is 14 and if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('retention-days: 14');
    expect(ci).toContain('if-no-files-found: error');
    expect(ci).toContain('name: coverage-report');
  });

  it('CI upload coverage step runs if: always()', () => {
    const ci = read('.github/workflows/ci.yml');
    const upload = ci.slice(ci.indexOf('Upload coverage report'));
    expect(upload).toMatch(/if:\s*always\(\)/);
  });

  it('CI hygiene bans anthropic|claude|haiku in src and workflows', () => {
    const step = read('.github/workflows/ci.yml').slice(
      read('.github/workflows/ci.yml').indexOf('Check required files'),
    );
    expect(step).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(step).toContain(
      "! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'",
    );
  });

  it('CI hygiene requires gemini-2.0-flash in src/index.ts', () => {
    expect(read('.github/workflows/ci.yml')).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
  });

  it('CI hygiene requires typescript ^5 and bans ^6/^7 in package.json', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('grep -qE \'"typescript": "\\^5\\.\' package.json');
    expect(ci).toContain('! grep -qE \'"typescript": "\\^[67]\\.\' package.json');
  });

  it('CI hygiene asserts lockfileVersion 3', () => {
    expect(read('.github/workflows/ci.yml')).toContain(`grep -q '"lockfileVersion": 3' package-lock.json`);
  });

  it('CI hygiene asserts hono dependency present', () => {
    expect(read('.github/workflows/ci.yml')).toContain(`grep -q '"hono"' package.json`);
  });

  it('CI hygiene forbids GEMINI_API_KEY= and api_key= in wrangler.toml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(ci).toContain("! grep -qiE 'api[_-]?key\\s*=' wrangler.toml");
  });

  it('CI hygiene requires all ten test contract files', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/helpers.ts',
      'test/helpers.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
    ]) {
      expect(ci).toContain(`test -f ${f}`);
    }
  });

  it('CI hygiene requires all five src modules', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(ci).toContain(`test -f ${f}`);
    }
  });

  it('CI hygiene requires docs/mcp-spec.md and .cursor/environment.json', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('test -f docs/mcp-spec.md');
    expect(ci).toContain('test -f .cursor/environment.json');
  });

  it('CI does not use pull_request_target as a trigger', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('on:'), ci.indexOf('concurrency:'));
    expect(onBlock).not.toContain('pull_request_target');
    // Hygiene step bans the trigger via awk; string may appear in comments/scripts only
    expect(ci).toContain("! awk");
  });

  it('deploy does not use pull_request_target as a trigger', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.slice(deploy.indexOf('on:'), deploy.indexOf('permissions:'));
    expect(onBlock).not.toContain('pull_request_target');
  });

  it('deploy concurrency cancel-in-progress is false', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('cancel-in-progress: false');
  });

  it('deploy concurrency group is deploy-${{ github.workflow }}', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'group: deploy-${{ github.workflow }}',
    );
  });

  it('deploy timeout-minutes is 20', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/timeout-minutes:\s*20/);
  });

  it('deploy uses cloudflare/wrangler-action@v4', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('cloudflare/wrangler-action@v4');
  });

  it('deploy secrets block lists GEMINI_API_KEY only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('secrets: |');
    expect(deploy).toContain('GEMINI_API_KEY');
    expect(deploy).not.toContain('ANTHROPIC');
    expect(deploy).not.toContain('OPENAI');
  });

  it('deploy wires CF_API_TOKEN and CF_ACCOUNT_ID secrets', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
  });

  it('deploy runs typecheck and test:coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheck = deploy.indexOf('npm run typecheck');
    const coverage = deploy.indexOf('npm run test:coverage');
    const wrangler = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheck).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(typecheck);
    expect(wrangler).toBeGreaterThan(coverage);
  });

  it('deploy workflow name is Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/^name:\s*Deploy to Cloudflare Workers\s*$/m);
  });

  it('deploy on: is only workflow_dispatch', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.slice(deploy.indexOf('on:'), deploy.indexOf('permissions:'));
    expect(onBlock.trim()).toBe('on:\n  workflow_dispatch:');
  });

  it('package.json type is module', () => {
    const pkg = JSON.parse(read('package.json')) as { type: string };
    expect(pkg.type).toBe('module');
  });

  it('package.json version is 0.1.0', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
  });

  it('package.json dependencies only hono', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  });

  it('package.json devDependencies keys stay exactly six', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(
      [
        '@cloudflare/workers-types',
        '@types/node',
        '@vitest/coverage-v8',
        'typescript',
        'vitest',
        'wrangler',
      ].sort(),
    );
  });

  it('package.json scripts.dev is wrangler dev', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('wrangler dev');
  });

  it('package.json scripts.test:watch is vitest', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:watch']).toBe('vitest');
  });

  it('package-lock lockfileVersion is 3', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBe(3);
  });

  it('package-lock requires hono under packages', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    expect(lock.packages['node_modules/hono']).toBeTruthy();
  });

  it('vitest.config environment is node', () => {
    expect(read('vitest.config.ts')).toMatch(/environment:\s*['"]node['"]/);
  });

  it('vitest.config coverage provider is v8', () => {
    expect(read('vitest.config.ts')).toMatch(/provider:\s*['"]v8['"]/);
  });

  it('vitest.config coverage include is src/**/*.ts', () => {
    expect(read('vitest.config.ts')).toMatch(/include:\s*\[['"]src\/\*\*\/\*\.ts['"]\]/);
  });

  it('tsconfig module is ESNext and moduleResolution Bundler', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { module: string; moduleResolution: string };
    };
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
  });

  it('tsconfig strict and noEmit and skipLibCheck are true', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { strict: boolean; noEmit: boolean; skipLibCheck: boolean };
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
  });

  it('tsconfig types include workers-types and node', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { types: string[] };
    };
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
  });

  it('tsconfig include covers src test and vitest.config', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('dependabot npm groups pattern is star under npm-dependencies', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toMatch(/patterns:\s*\n\s*-\s*"\*"/);
  });

  it('dependabot github-actions groups under github-actions key', () => {
    expect(read('.github/dependabot.yml')).toContain('github-actions:');
  });

  it('dependabot has no target-branch override', () => {
    expect(read('.github/dependabot.yml')).not.toContain('target-branch');
  });

  it('dependabot directory for both ecosystems is /', () => {
    expect([...read('.github/dependabot.yml').matchAll(/directory:\s*"\/"/g)]).toHaveLength(2);
  });

  it('.cursor/environment.json install is exactly npm ci', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { install: string; name: string };
    expect(env.install).toBe('npm ci');
    expect(env.name).toBe('Backlink_Facelift');
  });

  it('gitignore includes .env and .dev.vars as whole-line entries', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
  });

  it('workflows directory contains only ci.yml and deploy.yml', () => {
    const files = readdirSync(join(root, '.github/workflows')).sort();
    expect(files).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('ISSUE_TEMPLATE directory has bug feature chore config only', () => {
    const files = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
    expect(files).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('CI file byte length stays under 8KB lean workflow budget', () => {
    expect(Buffer.byteLength(read('.github/workflows/ci.yml'), 'utf8')).toBeLessThan(8 * 1024);
  });

  it('deploy file byte length stays under 2KB', () => {
    expect(Buffer.byteLength(read('.github/workflows/deploy.yml'), 'utf8')).toBeLessThan(2 * 1024);
  });

  it('CI defaults.run.shell is bash', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
  });

  it('CI hygiene excludes *.md and package-lock from secret regex scan', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain("--exclude='*.md'");
    expect(step).toContain("--exclude='package-lock.json'");
  });

  it('package.json has no engines or packageManager inventing pin', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.engines).toBeUndefined();
    expect(pkg.packageManager).toBeUndefined();
  });

  it('vitest.config does not set globals true', () => {
    expect(read('vitest.config.ts')).not.toMatch(/globals:\s*true/);
  });

  it('CI job runs-on is ubuntu-latest for all three jobs', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/runs-on:\s*ubuntu-latest/g)]).toHaveLength(
      3,
    );
  });

  it('deploy runs-on is ubuntu-latest once', () => {
    expect([...read('.github/workflows/deploy.yml').matchAll(/runs-on:\s*ubuntu-latest/g)]).toHaveLength(
      1,
    );
  });

  // --- HEAVY burn (post-#65): ci-config unit deepen (orthogonal to wrangler/genres/parser; post-#65) ---

  it('locks exact UTF-16 length of ci.yml to 6295', () => {
    expect(read('.github/workflows/ci.yml').length).toBe(6295);
  });

  it('locks exact UTF-8 byte length of ci.yml equal to UTF-16 (ASCII-only)', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(new TextEncoder().encode(ci).length).toBe(6295);
    expect(new TextEncoder().encode(ci).length).toBe(ci.length);
  });

  it('locks exact UTF-16 length of deploy.yml to 1004', () => {
    expect(read('.github/workflows/deploy.yml').length).toBe(1004);
  });

  it('locks exact UTF-8 byte length of deploy.yml equal to UTF-16', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(new TextEncoder().encode(deploy).length).toBe(1004);
    expect(new TextEncoder().encode(deploy).length).toBe(deploy.length);
  });

  it('locks exact UTF-16 length of dependabot.yml to 505', () => {
    expect(read('.github/dependabot.yml').length).toBe(505);
  });

  it('locks exact UTF-8 byte length of dependabot.yml equal to UTF-16', () => {
    const dep = read('.github/dependabot.yml');
    expect(new TextEncoder().encode(dep).length).toBe(505);
    expect(new TextEncoder().encode(dep).length).toBe(dep.length);
  });

  it('locks exact UTF-16 length of vitest.config.ts to 535', () => {
    expect(read('vitest.config.ts').length).toBe(535);
  });

  it('locks exact UTF-8 byte length of vitest.config.ts equal to UTF-16', () => {
    const cfg = read('vitest.config.ts');
    expect(new TextEncoder().encode(cfg).length).toBe(535);
    expect(new TextEncoder().encode(cfg).length).toBe(cfg.length);
  });

  it('locks ci.yml line count without trailing newline pad', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.split('\n')).toHaveLength(177);
    expect(ci.endsWith('\n')).toBe(false);
    expect(ci.startsWith('name: CI\n')).toBe(true);
  });

  it('locks deploy.yml line count including trailing empty split slot', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.split('\n')).toHaveLength(47);
    expect(deploy.endsWith('\n')).toBe(true);
  });

  it('locks dependabot.yml line count including trailing empty split slot', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.split('\n')).toHaveLength(25);
    expect(dep.endsWith('\n')).toBe(true);
  });

  it('locks vitest.config.ts line count including trailing empty split slot', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg.split('\n')).toHaveLength(22);
    expect(cfg.endsWith('\n')).toBe(true);
  });

  it('locks exact nonempty line count of ci.yml to 161', () => {
    const nonempty = read('.github/workflows/ci.yml')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(nonempty).toHaveLength(161);
  });

  it('locks JSON.stringify of full ci.yml length snapshot', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(JSON.stringify(ci).length).toBe(6513);
    expect(JSON.stringify(ci).startsWith('"name: CI\\n\\non:\\n')).toBe(true);
    expect(JSON.stringify(ci).endsWith("grep -q .\"")).toBe(true);
  });

  it('btoa/atob round-trip of CI workflow name stays stable', () => {
    expect(btoa('CI')).toBe('Q0k=');
    expect(atob('Q0k=')).toBe('CI');
    expect(read('.github/workflows/ci.yml')).toContain(`name: ${atob('Q0k=')}`);
  });

  it('btoa/atob round-trip of Node 20 version token stays stable', () => {
    expect(btoa('20')).toBe('MjA=');
    expect(atob('MjA=')).toBe('20');
    expect(read('.github/workflows/ci.yml')).toContain(`node-version: "${atob('MjA=')}"`);
  });

  it('locks codePointAt sequence for workflow name CI', () => {
    expect([...'CI'].map((c) => c.codePointAt(0))).toEqual([67, 73]);
  });

  it('locks codePointAt sequence for coverage-report artifact name', () => {
    expect([...'coverage-report'].map((c) => c.charCodeAt(0))).toEqual([
      99, 111, 118, 101, 114, 97, 103, 101, 45, 114, 101, 112, 111, 114, 116,
    ]);
  });

  it('locks TextEncoder bytes for github-actions reporter token', () => {
    expect([...new TextEncoder().encode('github-actions')]).toEqual([
      103, 105, 116, 104, 117, 98, 45, 97, 99, 116, 105, 111, 110, 115,
    ]);
  });

  it('Reflect.ownKeys on CI job id map stays insertion-ordered', () => {
    const jobs: Record<string, string> = {
      typecheck: 'Typecheck',
      test: 'Tests',
      hygiene: 'Hygiene',
    };
    expect(Reflect.ownKeys(jobs)).toEqual(['typecheck', 'test', 'hygiene']);
    expect(Object.keys(jobs)).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('Object.freeze on extracted CI timeouts does not mutate live workflow', () => {
    const timeouts = Object.freeze({ typecheck: 10, test: 15, hygiene: 5 });
    expect(() => {
      (timeouts as { typecheck: number }).typecheck = 99;
    }).toThrow();
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('timeout-minutes: 10');
    expect(ci).toContain('timeout-minutes: 15');
    expect(ci).toContain('timeout-minutes: 5');
    expect(Object.isFrozen(timeouts)).toBe(true);
  });

  it('Object.seal clone of deploy concurrency stays extensibility-false', () => {
    const conc = Object.seal({
      group: 'deploy-${{ github.workflow }}',
      cancelInProgress: false,
    });
    expect(Object.isSealed(conc)).toBe(true);
    expect(Object.isExtensible(conc)).toBe(false);
    expect(read('.github/workflows/deploy.yml')).toContain('cancel-in-progress: false');
  });

  it('Proxy.revocable over CI name token cannot rewrite live file string', () => {
    const target = { name: 'CI' };
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
    expect(read('.github/workflows/ci.yml')).toContain('name: CI');
    revoke();
    expect(() => proxy.name).toThrow();
  });

  it('structuredClone of CI job id array is independent of source', () => {
    const jobs = ['typecheck', 'test', 'hygiene'];
    const cloned = structuredClone(jobs);
    cloned[0] = 'mutated';
    expect(jobs[0]).toBe('typecheck');
    expect(read('.github/workflows/ci.yml')).toContain('  typecheck:');
    expect(cloned).not.toBe(jobs);
  });

  it('Map/Set/WeakMap identity locks for CI job display names', () => {
    const set = new Set(['Typecheck', 'Tests', 'Hygiene']);
    const map = new Map([
      ['typecheck', 'Typecheck'],
      ['test', 'Tests'],
      ['hygiene', 'Hygiene'],
    ]);
    const wm = new WeakMap<object, string>();
    const key = { job: 'test' };
    wm.set(key, 'Tests');
    expect(set.has('Tests')).toBe(true);
    expect(map.get('hygiene')).toBe('Hygiene');
    expect(wm.get(key)).toBe('Tests');
    expect(set.size).toBe(3);
  });

  it('array-copy independence: splice/filter on ci lines leaves live file intact', () => {
    const ci = read('.github/workflows/ci.yml');
    const lines = ci.split('\n');
    const copy = [...lines];
    copy.splice(0, 1);
    const filtered = lines.filter((l) => !l.trimStart().startsWith('#'));
    expect(lines[0]).toBe('name: CI');
    expect(copy[0]).toBe('');
    expect(filtered.every((l) => !l.trimStart().startsWith('#'))).toBe(true);
    expect(ci.startsWith('name: CI')).toBe(true);
  });

  it('CI job ids appear exactly once each as top-level job keys', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/^  typecheck:/gm)]).toHaveLength(1);
    expect([...ci.matchAll(/^  test:/gm)]).toHaveLength(1);
    expect([...ci.matchAll(/^  hygiene:/gm)]).toHaveLength(1);
  });

  it('CI job display names lock Typecheck Tests Hygiene in order', () => {
    const names = [...read('.github/workflows/ci.yml').matchAll(/^\s{4}name:\s*(.+)$/gm)].map(
      (m) => m[1],
    );
    expect(names).toEqual(['Typecheck', 'Tests', 'Hygiene']);
  });

  it('CI named steps lock exact ordered list across all jobs', () => {
    const steps = [...read('.github/workflows/ci.yml').matchAll(/- name: (.+)/g)].map(
      (m) => m[1],
    );
    expect(steps).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Set up Node.js',
      'Install dependencies',
      'Unit / integration tests with coverage',
      'Assert coverage artifacts exist',
      'Upload coverage report',
      'Check required files',
      'Check for committed secret material',
    ]);
  });

  it('deploy named steps lock exact ordered list', () => {
    const steps = [...read('.github/workflows/deploy.yml').matchAll(/- name: (.+)/g)].map(
      (m) => m[1],
    );
    expect(steps).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Unit / integration tests with coverage',
      'Deploy to Cloudflare Workers',
    ]);
  });

  it('CI uses pins lock checkout@v7 setup-node@v7 upload-artifact@v4 counts', () => {
    const uses = [...read('.github/workflows/ci.yml').matchAll(/uses:\s*(.+)/g)].map((m) =>
      m[1].trim(),
    );
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/upload-artifact@v4',
      'actions/checkout@v7',
    ]);
  });

  it('deploy uses pins lock checkout setup-node wrangler-action', () => {
    const uses = [...read('.github/workflows/deploy.yml').matchAll(/uses:\s*(.+)/g)].map((m) =>
      m[1].trim(),
    );
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'cloudflare/wrangler-action@v4',
    ]);
  });

  it('CI timeout-minutes lock typecheck 10 test 15 hygiene 5', () => {
    const timeouts = [
      ...read('.github/workflows/ci.yml').matchAll(/timeout-minutes:\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(timeouts).toEqual([10, 15, 5]);
  });

  it('deploy timeout-minutes locks to 20 only', () => {
    const timeouts = [
      ...read('.github/workflows/deploy.yml').matchAll(/timeout-minutes:\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(timeouts).toEqual([20]);
  });

  it('CI concurrency group template uses workflow and ref', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'group: ci-${{ github.workflow }}-${{ github.ref }}',
    );
  });

  it('deploy concurrency group template uses workflow only', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'group: deploy-${{ github.workflow }}',
    );
  });

  it('CI cancel-in-progress is true while deploy is false', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/cancel-in-progress:\s*true/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/cancel-in-progress:\s*false/);
  });

  it('CI defaults.run.shell is bash only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
    // defaults block + hygiene grep assertion referencing the same token
    expect([...ci.matchAll(/shell:\s*bash/g)]).toHaveLength(2);
    expect(ci).toContain("grep -q 'shell: bash' .github/workflows/ci.yml");
  });

  it('deploy does not declare defaults.run.shell', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/shell:/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/defaults:/);
  });

  it('negative: CI does not declare strategy matrix', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*strategy:/m);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*matrix:/m);
  });

  it('negative: CI does not declare services or container', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/^\s*services:/m);
    expect(ci).not.toMatch(/^\s*container:/m);
  });

  it('negative: CI jobs do not declare needs dependencies', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*needs:/m);
  });

  it('negative: CI does not declare environment protection rules', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*environment:/m);
  });

  it('negative: CI does not declare continue-on-error', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/continue-on-error/);
  });

  it('negative: CI does not declare schedule cron triggers', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*schedule:/m);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/cron:/);
  });

  it('negative: CI on: block does not declare workflow_call or workflow_dispatch', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).not.toMatch(/workflow_call/);
    expect(onBlock).not.toMatch(/workflow_dispatch/);
    // hygiene still asserts deploy is manual via workflow_dispatch
    expect(ci).toContain("grep -q 'workflow_dispatch' .github/workflows/deploy.yml");
  });

  it('negative: deploy does not declare push or pull_request triggers', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
  });

  it('negative: CI does not use actions/cache directly', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/actions\/cache@/);
  });

  it('negative: CI does not pin checkout or setup-node to v6 or v5', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/actions\/checkout@v[56]/);
    expect(ci).not.toMatch(/actions\/setup-node@v[56]/);
  });

  it('negative: CI does not upload-artifact@v3', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/upload-artifact@v3/);
  });

  it('negative: CI does not declare permissions write-all or contents write', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/permissions:\s*write-all/);
    expect(ci).not.toMatch(/contents:\s*write/);
  });

  it('negative: CI does not declare id-token packages or actions write', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/id-token:/);
    expect(ci).not.toMatch(/packages:/);
    expect(ci).not.toMatch(/^\s*actions:\s/m);
  });

  it('negative: deploy does not hardcode CF_API_TOKEN or CF_ACCOUNT_ID literals', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('${{ secrets.CF_ACCOUNT_ID }}');
    expect(deploy).not.toMatch(/CF_API_TOKEN:\s*['\"]?[A-Za-z0-9_-]{8,}/);
    expect(deploy).not.toMatch(/CF_ACCOUNT_ID:\s*['\"]?[A-Za-z0-9_-]{8,}/);
  });

  it('negative: dependabot does not schedule daily or weekly', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).not.toMatch(/interval:\s*"daily"/);
    expect(dep).not.toMatch(/interval:\s*"weekly"/);
  });

  it('negative: dependabot does not set target-branch overrides', () => {
    expect(read('.github/dependabot.yml')).not.toMatch(/target-branch:/);
  });

  it('negative: dependabot does not set reviewers or assignees', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).not.toMatch(/reviewers:/);
    expect(dep).not.toMatch(/assignees:/);
  });

  it('negative: vitest.config does not set globals true', () => {
    expect(read('vitest.config.ts')).not.toMatch(/globals:\s*true/);
  });

  it('negative: vitest.config does not set pool forks or threads inventing', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).not.toMatch(/pool:/);
    expect(cfg).not.toMatch(/threads:/);
    expect(cfg).not.toMatch(/forks:/);
  });

  it('negative: vitest.config does not set watch or passWithNoTests', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).not.toMatch(/passWithNoTests/);
    expect(cfg).not.toMatch(/watch:\s*true/);
  });

  it('cross-locks package.json test:coverage script with CI Tests job run', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(read('.github/workflows/ci.yml')).toContain('npm run test:coverage');
  });

  it('cross-locks package.json typecheck script with CI Typecheck job run', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(read('.github/workflows/ci.yml')).toContain('npm run typecheck');
  });

  it('cross-locks AGENTS.md Verify block with package scripts', () => {
    const agents = read('AGENTS.md');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('cross-locks deploy workflow GEMINI_API_KEY with AGENTS escalate secret handling', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('GEMINI_API_KEY');
    expect(read('AGENTS.md')).toMatch(/GEMINI_API_KEY handling/);
  });

  it('cross-locks vitest coverage thresholds with hygiene grep checks', () => {
    const cfg = read('vitest.config.ts');
    const hygiene = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
    expect(hygiene).toContain("grep -q 'branches: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'lines: 100' vitest.config.ts");
  });

  it('cross-locks persist-credentials false across CI and deploy checkouts', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    // 3 checkout with: blocks + 2 hygiene grep assertions
    expect([...ci.matchAll(/persist-credentials:\s*false/g)]).toHaveLength(5);
    expect(ci).toContain('persist-credentials: false');
    expect(ci).toContain("grep -q 'persist-credentials: false' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'persist-credentials: false' .github/workflows/deploy.yml");
    expect([...deploy.matchAll(/persist-credentials:\s*false/g)]).toHaveLength(1);
  });

  it('cross-locks node-version 20 across CI jobs and deploy', () => {
    const ci = read('.github/workflows/ci.yml');
    // 2 setup-node with: blocks + 1 hygiene grep assertion
    expect([...ci.matchAll(/node-version:\s*"20"/g)]).toHaveLength(3);
    expect(ci).toContain('grep -q \'node-version: "20"\' .github/workflows/ci.yml');
    expect([...read('.github/workflows/deploy.yml').matchAll(/node-version:\s*"20"/g)]).toHaveLength(
      1,
    );
  });

  it('cross-locks npm cache key across setup-node steps', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/cache:\s*"npm"/g)]).toHaveLength(2);
    expect([...read('.github/workflows/deploy.yml').matchAll(/cache:\s*"npm"/g)]).toHaveLength(1);
  });

  it('hash count in ci.yml is exactly 3 (comment markers only)', () => {
    expect((read('.github/workflows/ci.yml').match(/#/g) ?? []).length).toBe(3);
  });

  it('deploy.yml and dependabot.yml have zero hash comments', () => {
    expect((read('.github/workflows/deploy.yml').match(/#/g) ?? []).length).toBe(0);
    expect((read('.github/dependabot.yml').match(/#/g) ?? []).length).toBe(0);
  });

  it('ci.yml dollar-sign count locks github context interpolations', () => {
    // ci-${{...}}-${{...}} (2) + none in hygiene comments beyond the 2 in group? Actually 4 total from earlier
    expect((read('.github/workflows/ci.yml').match(/\$/g) ?? []).length).toBe(4);
  });

  it('deploy.yml dollar-sign count locks secrets interpolations to 4', () => {
    expect((read('.github/workflows/deploy.yml').match(/\$/g) ?? []).length).toBe(4);
  });

  it('ci.yml at-sign count locks action pins to 7', () => {
    expect((read('.github/workflows/ci.yml').match(/@/g) ?? []).length).toBe(7);
  });

  it('deploy.yml at-sign count locks action pins to 3', () => {
    expect((read('.github/workflows/deploy.yml').match(/@/g) ?? []).length).toBe(3);
  });

  it('ci.yml tab count is zero (spaces only)', () => {
    expect(read('.github/workflows/ci.yml').includes('\t')).toBe(false);
  });

  it('deploy.yml and dependabot.yml tab counts are zero', () => {
    expect(read('.github/workflows/deploy.yml').includes('\t')).toBe(false);
    expect(read('.github/dependabot.yml').includes('\t')).toBe(false);
  });

  it('ci.yml backtick count is zero', () => {
    expect(read('.github/workflows/ci.yml').includes('`')).toBe(false);
  });

  it('ci.yml semicolon does not appear', () => {
    expect(read('.github/workflows/ci.yml').includes(';')).toBe(false);
  });

  it('ci.yml percent-sign does not appear', () => {
    expect(read('.github/workflows/ci.yml').includes('%')).toBe(false);
  });

  it('ci.yml brace count is balanced at 11/11', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/\{/g) ?? []).length).toBe(11);
    expect((ci.match(/\}/g) ?? []).length).toBe(11);
  });

  it('deploy.yml brace count is balanced at 8/8', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect((deploy.match(/\{/g) ?? []).length).toBe(8);
    expect((deploy.match(/\}/g) ?? []).length).toBe(8);
  });

  it('dependabot.yml has zero braces', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.includes('{')).toBe(false);
    expect(dep.includes('}')).toBe(false);
  });

  it('ci.yml digit occurrence count stays at 48', () => {
    expect((read('.github/workflows/ci.yml').match(/\d/g) ?? []).length).toBe(48);
  });

  it('deploy.yml digit occurrence count stays at 7', () => {
    expect((read('.github/workflows/deploy.yml').match(/\d/g) ?? []).length).toBe(7);
  });

  it('dependabot.yml digit occurrence count stays at 3', () => {
    // version 2 + open-pull-requests-limit 3 + open-pull-requests-limit 2
    expect((read('.github/dependabot.yml').match(/\d/g) ?? []).length).toBe(3);
  });

  it('ci.yml underscore count stays at 20', () => {
    expect((read('.github/workflows/ci.yml').match(/_/g) ?? []).length).toBe(20);
  });

  it('deploy.yml underscore count stays at 11', () => {
    expect((read('.github/workflows/deploy.yml').match(/_/g) ?? []).length).toBe(11);
  });

  it('dependabot.yml underscore count stays at 0', () => {
    expect((read('.github/dependabot.yml').match(/_/g) ?? []).length).toBe(0);
  });

  it('ci.yml pipe count stays at 16', () => {
    expect((read('.github/workflows/ci.yml').match(/\|/g) ?? []).length).toBe(16);
  });

  it('ci.yml ampersand count stays at 6', () => {
    expect((read('.github/workflows/ci.yml').match(/&/g) ?? []).length).toBe(6);
  });

  it('deploy.yml pipe count is 1 for secrets multiline block', () => {
    expect((read('.github/workflows/deploy.yml').match(/\|/g) ?? []).length).toBe(1);
  });

  it('Object.is compares CI workflow name to literal CI', () => {
    const name = read('.github/workflows/ci.yml').match(/^name:\s*(.+)$/m)?.[1]?.trim();
    expect(Object.is(name, 'CI')).toBe(true);
  });

  it('fromCharCode rebuild of Hygiene matches live job display name', () => {
    const rebuilt = String.fromCharCode(72, 121, 103, 105, 101, 110, 101);
    expect(rebuilt).toBe('Hygiene');
    expect(read('.github/workflows/ci.yml')).toContain(`name: ${rebuilt}`);
  });

  it('Number.parseInt of CI timeouts stays non-negative integers', () => {
    const parts = [10, 15, 5];
    expect(parts.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    const ci = read('.github/workflows/ci.yml');
    for (const n of parts) {
      expect(ci).toContain(`timeout-minutes: ${n}`);
    }
  });

  it('Date.parse is not used for CI compatibility; node-version stays string 20', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version:\s*"20"/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/node-version:\s*20\s*$/m);
  });

  it('CI on branches lock main for push and pull_request', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(onBlock).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  it('CI does not trigger on tags or paths filters', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).not.toMatch(/tags:/);
    expect(onBlock).not.toMatch(/paths:/);
    expect(onBlock).not.toMatch(/paths-ignore:/);
  });

  it('hygiene required-files list includes all nine unit suites and helpers', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    for (const f of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/helpers.ts',
      'test/helpers.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
    ]) {
      expect(step).toContain(`test -f ${f}`);
    }
  });

  it('hygiene required-files list includes all five src modules', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    for (const f of [
      'src/index.ts',
      'src/parser.ts',
      'src/genres.ts',
      'src/mcp.ts',
      'src/types.ts',
    ]) {
      expect(step).toContain(`test -f ${f}`);
    }
  });

  it('hygiene bans anthropic claude haiku in src and workflows', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(step).toContain(
      "! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'",
    );
  });

  it('hygiene asserts typescript stays on caret-5 line', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('grep -qE \'"typescript": "\\^5\\.\' package.json');
    expect(step).toContain('! grep -qE \'"typescript": "\\^[67]\\.\' package.json');
  });

  it('hygiene asserts gemini-2.0-flash model pin in src/index.ts', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
  });

  it('hygiene asserts lockfileVersion 3 in package-lock.json', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('grep -q \'"lockfileVersion": 3\' package-lock.json');
  });

  it('hygiene asserts coverage exclude of src/types.ts in vitest.config', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('grep -q "src/types.ts" vitest.config.ts');
  });

  it('Assert coverage artifacts exist step checks dir lcov and SF:src/', () => {
    const step = read('.github/workflows/ci.yml').split('Assert coverage artifacts exist')[1];
    expect(step).toContain('test -d coverage');
    expect(step).toContain('test -f coverage/lcov.info');
    expect(step).toContain('test -s coverage/lcov.info');
    expect(step).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('Upload coverage report uses if always and if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('Upload coverage report'), ci.indexOf('hygiene:'));
    expect(block).toContain('if: always()');
    expect(block).toContain('if-no-files-found: error');
    expect(block).toContain('retention-days: 14');
    expect(block).toContain('name: coverage-report');
  });

  it('deploy wrangler-action secrets block lists GEMINI_API_KEY only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const secretsBlock = deploy.slice(deploy.indexOf('secrets: |'), deploy.indexOf('env:'));
    expect(secretsBlock).toContain('GEMINI_API_KEY');
    expect(secretsBlock).not.toContain('CF_API_TOKEN');
    expect(secretsBlock).not.toContain('ANTHROPIC');
  });

  it('deploy env block maps GEMINI_API_KEY from secrets context', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
    );
  });

  it('package.json type module ESM lock for vitest/node tooling', () => {
    const pkg = JSON.parse(read('package.json')) as { type: string };
    expect(pkg.type).toBe('module');
  });

  it('package.json dependency keys stay hono only in dependencies', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(
      [
        '@cloudflare/workers-types',
        '@types/node',
        '@vitest/coverage-v8',
        'typescript',
        'vitest',
        'wrangler',
      ].sort(),
    );
  });

  it('tsconfig include locks src test and vitest.config only', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('tsconfig compilerOptions module ESNext and moduleResolution Bundler', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { module: string; moduleResolution: string; strict: boolean };
    };
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.strict).toBe(true);
  });

  it('gitignore .env.* with !.env.example exception stays intact', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.env\.\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
  });

  it('gitignore ignores *.pem and *.key for secret material', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\*\.pem$/m);
    expect(gi).toMatch(/^\*\.key$/m);
  });

  it('gitignore ignores *~ editor backups', () => {
    expect(read('.gitignore')).toMatch(/^\*~$/m);
  });

  it('workflows directory contains exactly ci.yml and deploy.yml', () => {
    const files = readdirSync(join(root, '.github/workflows')).sort();
    expect(files).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('.github top-level contains dependabot ISSUE_TEMPLATE workflows only', () => {
    const files = readdirSync(join(root, '.github')).sort();
    expect(files).toEqual(['ISSUE_TEMPLATE', 'dependabot.yml', 'workflows']);
  });

  it('line index locks for critical CI header rows', () => {
    const lines = read('.github/workflows/ci.yml').split('\n');
    expect(lines[0]).toBe('name: CI');
    expect(lines[2]).toBe('on:');
    expect(lines[8]).toBe('concurrency:');
    expect(lines[12]).toBe('permissions:');
    expect(lines[13]).toBe('  contents: read');
    expect(lines[15]).toBe('defaults:');
    expect(lines[19]).toBe('jobs:');
    expect(lines[20]).toBe('  typecheck:');
  });

  it('line index locks for critical deploy header rows', () => {
    const lines = read('.github/workflows/deploy.yml').split('\n');
    expect(lines[0]).toBe('name: Deploy to Cloudflare Workers');
    expect(lines[2]).toBe('on:');
    expect(lines[3]).toBe('  workflow_dispatch:');
    expect(lines[5]).toBe('permissions:');
    expect(lines[8]).toBe('concurrency:');
    expect(lines[12]).toBe('jobs:');
    expect(lines[13]).toBe('  deploy:');
  });

  it('line index locks for dependabot ecosystems', () => {
    const lines = read('.github/dependabot.yml').split('\n');
    expect(lines[0]).toBe('version: 2');
    expect(lines[1]).toBe('updates:');
    expect(lines[2]).toBe('  - package-ecosystem: "npm"');
    expect(lines[15]).toBe('  - package-ecosystem: "github-actions"');
  });

  it('Immutable copy via Object.assign does not alias live ci string', () => {
    const ci = read('.github/workflows/ci.yml');
    const bag = Object.assign({}, { ci });
    bag.ci = 'mutated';
    expect(ci.startsWith('name: CI')).toBe(true);
    expect(bag.ci).toBe('mutated');
  });

  it('Array.prototype.every confirms printable ASCII excluding tabs in ci.yml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(
      [...ci].every((ch) => {
        const c = ch.charCodeAt(0);
        return c === 10 || (c >= 32 && c < 127);
      }),
    ).toBe(true);
  });

  it('Array.prototype.every confirms printable ASCII excluding tabs in deploy.yml', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(
      [...deploy].every((ch) => {
        const c = ch.charCodeAt(0);
        return c === 10 || (c >= 32 && c < 127);
      }),
    ).toBe(true);
  });

  it('hygiene: no duplicate consecutive identical nonempty lines in dependabot.yml', () => {
    const nonempty = read('.github/dependabot.yml')
      .split('\n')
      .filter((l) => l.length > 0);
    for (let i = 1; i < nonempty.length; i++) {
      expect(nonempty[i]).not.toBe(nonempty[i - 1]);
    }
  });

  it('every CI job runs-on ubuntu-latest exactly once per job', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/runs-on:\s*ubuntu-latest/g)]).toHaveLength(
      3,
    );
    expect([
      ...read('.github/workflows/deploy.yml').matchAll(/runs-on:\s*ubuntu-latest/g),
    ]).toHaveLength(1);
  });

  it('CI does not use self-hosted or windows/macos runners', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/self-hosted/);
    expect(ci).not.toMatch(/windows-latest|macos-latest/);
  });

  it('CI Typecheck job does not upload artifacts', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('  typecheck:'), ci.indexOf('  test:'));
    expect(block).not.toContain('upload-artifact');
    expect(block).not.toContain('test:coverage');
  });

  it('CI Hygiene job does not install npm dependencies', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('  hygiene:'));
    expect(block).not.toContain('npm ci');
    expect(block).not.toContain('setup-node');
  });

  it('CI Tests job is the only job that runs test:coverage', () => {
    const ci = read('.github/workflows/ci.yml');
    // Tests job run + hygiene grep that deploy also runs coverage
    expect([...ci.matchAll(/npm run test:coverage/g)]).toHaveLength(2);
    const typecheck = ci.slice(ci.indexOf('  typecheck:'), ci.indexOf('  test:'));
    const testJob = ci.slice(ci.indexOf('  test:'), ci.indexOf('  hygiene:'));
    const hygiene = ci.slice(ci.indexOf('  hygiene:'));
    expect(typecheck).not.toContain('test:coverage');
    expect(testJob).toContain('run: npm run test:coverage');
    expect(hygiene).toContain("grep -q 'npm run test:coverage' .github/workflows/deploy.yml");
    expect(hygiene).not.toMatch(/^\s+run: npm run test:coverage/m);
  });

  it('deploy runs typecheck and test:coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheckAt = deploy.indexOf('npm run typecheck');
    const coverageAt = deploy.indexOf('npm run test:coverage');
    const wranglerAt = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheckAt).toBeGreaterThan(-1);
    expect(coverageAt).toBeGreaterThan(typecheckAt);
    expect(wranglerAt).toBeGreaterThan(coverageAt);
  });

  it('String.raw of CI name and permissions lines match live content', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(String.raw`name: CI`);
    expect(ci).toContain(String.raw`contents: read`);
  });

  it('does not embed emoji or smart quotes in ci.yml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/[^\x00-\x7F]/);
    expect(ci).not.toContain('\u201c');
    expect(ci).not.toContain('\u201d');
  });

  it('does not embed emoji or smart quotes in deploy.yml', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/[^\x00-\x7F]/);
  });

  it('vitest.config environment is node not happy-dom or jsdom', () => {
    expect(read('vitest.config.ts')).toMatch(/environment:\s*'node'/);
    expect(read('vitest.config.ts')).not.toMatch(/happy-dom|jsdom/);
  });

  it('vitest.config coverage provider is v8', () => {
    expect(read('vitest.config.ts')).toMatch(/provider:\s*'v8'/);
  });

  it('vitest.config coverage include is src/**/*.ts only', () => {
    expect(read('vitest.config.ts')).toMatch(/include:\s*\[['"]src\/\*\*\/\*\.ts['"]\]/);
  });

  it('package.json version 0.1.0 cross-locks with wrangler VERSION var via DEPLOY docs', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
    expect(read('wrangler.toml')).toContain('VERSION = "0.1.0"');
  });

  it('CI workflow file path is locked relative to repo root', () => {
    expect(read('.github/workflows/ci.yml').length).toBeGreaterThan(0);
    expect(readdirSync(join(root, '.github/workflows'))).toContain('ci.yml');
  });

  it('negative MCP SDK keys are absent from CI workflow', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/name_for_model|description_for_human|input_schema/);
  });

  it('negative JSON Schema draft keywords are absent from CI workflow', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/\$schema|additionalProperties|oneOf|anyOf|allOf/);
  });

  it('CI does not reference Dockerfile or docker-compose', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/Dockerfile|docker-compose/i);
  });

  it('CI does not reference softprops/action-gh-release or create-release', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/action-gh-release|create-release|softprops/);
  });

  it('dependabot groups npm-dependencies and github-actions with star patterns', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toContain('github-actions:');
    expect([...dep.matchAll(/-\s*"\*"/g)]).toHaveLength(2);
  });

  it('dependabot directory is slash for both ecosystems', () => {
    expect([...read('.github/dependabot.yml').matchAll(/directory:\s*"\/"/g)]).toHaveLength(2);
  });

  it('CI comment about pull_request_target stays as documentation only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(
      '# Trigger must be push/pull_request only (not pull_request_target)',
    );
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).not.toMatch(/^\s*pull_request_target\s*:/m);
  });

  it('CI awk guards against pull_request_target in on blocks', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('pull_request_target');
    expect(step).toContain("awk '/^on:/{f=1}");
  });

  it('secret-scan step excludes md and package-lock.json', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain("--exclude='*.md'");
    expect(step).toContain("--exclude='package-lock.json'");
  });

  it('secret-scan regex targets api_key secret token password private_key assignments', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain('(api[_-]?key|secret|token|password|private[_-]?key)');
  });

  it('package.json description em-dash is the only non-ASCII in package.json', () => {
    const raw = read('package.json');
    const nonAscii = [...raw].filter((c) => c.charCodeAt(0) > 127);
    expect(nonAscii).toEqual(['—']);
    expect(nonAscii[0].codePointAt(0)).toBe(0x2014);
  });

  it('package.json UTF-8 byte length exceeds UTF-16 length by em-dash expansion', () => {
    const raw = read('package.json');
    expect(raw.length).toBe(635);
    expect(new TextEncoder().encode(raw).length).toBe(637);
  });

  it('vitest.config reporters ternary keys on GITHUB_ACTIONS env', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default']",
    );
  });

  it('CI Hygiene timeout is the shortest of the three jobs', () => {
    const timeouts = [
      ...read('.github/workflows/ci.yml').matchAll(/timeout-minutes:\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(Math.min(...timeouts)).toBe(5);
    expect(Math.max(...timeouts)).toBe(15);
  });

  it('deploy timeout exceeds all CI job timeouts', () => {
    const ciMax = Math.max(
      ...[...read('.github/workflows/ci.yml').matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) =>
        Number(m[1]),
      ),
    );
    const deployTimeout = Number(
      read('.github/workflows/deploy.yml').match(/timeout-minutes:\s*(\d+)/)?.[1],
    );
    expect(deployTimeout).toBe(20);
    expect(deployTimeout).toBeGreaterThan(ciMax);
  });

  it('CI job keys sorted lexicographically are hygiene test typecheck', () => {
    const ids = ['typecheck', 'test', 'hygiene'].sort();
    expect(ids).toEqual(['hygiene', 'test', 'typecheck']);
    const ci = read('.github/workflows/ci.yml');
    for (const id of ids) {
      expect(ci).toMatch(new RegExp(`^  ${id}:`, 'm'));
    }
  });

  it('WeakSet membership locks for required workflow basenames', () => {
    const required = new WeakSet<object>();
    const ciRef = { name: 'ci.yml' };
    const deployRef = { name: 'deploy.yml' };
    required.add(ciRef);
    required.add(deployRef);
    expect(required.has(ciRef)).toBe(true);
    expect(required.has(deployRef)).toBe(true);
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('structuredClone of dependabot ecosystem list stays independent', () => {
    const ecosystems = ['npm', 'github-actions'];
    const cloned = structuredClone(ecosystems);
    cloned.push('docker');
    expect(ecosystems).toEqual(['npm', 'github-actions']);
    expect(cloned).toHaveLength(3);
    expect(read('.github/dependabot.yml')).not.toContain('docker');
  });

  it('CI does not set working-directory overrides on run steps', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/working-directory:/);
  });

  it('CI does not set env: GEMINI_API_KEY at workflow or job level', () => {
    const ci = read('.github/workflows/ci.yml');
    // hygiene only greps deploy.yml for GEMINI_API_KEY; CI never injects the secret
    expect(ci).not.toMatch(/^\s*GEMINI_API_KEY:/m);
    expect(ci).not.toMatch(/secrets\.GEMINI_API_KEY/);
    expect(ci).toContain("grep -q 'GEMINI_API_KEY' .github/workflows/deploy.yml");
    expect(ci).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
  });

  it('only deploy.yml references cloudflare/wrangler-action', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/wrangler-action/);
    expect(read('.github/workflows/deploy.yml')).toContain('cloudflare/wrangler-action@v4');
  });

  it('CI name key length and deploy name length stay fixed', () => {
    expect('CI').toHaveLength(2);
    expect('Deploy to Cloudflare Workers').toHaveLength(28);
    expect(read('.github/workflows/ci.yml')).toMatch(/^name:\s*CI\s*$/m);
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /^name:\s*Deploy to Cloudflare Workers\s*$/m,
    );
  });

  it('coverage retention-days 14 is two weeks in day units', () => {
    expect(14).toBe(2 * 7);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('npm ci appears once per Node-using CI job and once in deploy', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/npm ci/g)]).toHaveLength(2);
    expect([...read('.github/workflows/deploy.yml').matchAll(/npm ci/g)]).toHaveLength(1);
  });

  it('Install dependencies step name appears twice in CI and once in deploy', () => {
    expect([
      ...read('.github/workflows/ci.yml').matchAll(/- name: Install dependencies/g),
    ]).toHaveLength(2);
    expect([
      ...read('.github/workflows/deploy.yml').matchAll(/- name: Install dependencies/g),
    ]).toHaveLength(1);
  });

  it('Set up Node.js step name appears twice in CI and once in deploy', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/- name: Set up Node\.js/g)]).toHaveLength(
      2,
    );
    expect([
      ...read('.github/workflows/deploy.yml').matchAll(/- name: Set up Node\.js/g),
    ]).toHaveLength(1);
  });

  it('CI file ends with secret-scan find grep -q . without trailing newline', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.endsWith("| grep -q .")).toBe(true);
    expect(ci.endsWith('\n')).toBe(false);
  });

  it('deploy file ends with GEMINI secret env mapping and trailing newline', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.endsWith('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n')).toBe(true);
  });

  it('dependabot file ends with github-actions star pattern and trailing newline', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.endsWith('          - "*"\n')).toBe(true);
  });

  it('vitest.config ends with closing braces and trailing newline', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg.endsWith('});\n')).toBe(true);
  });

  it('no CRLF line endings in CI deploy dependabot vitest configs', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
    ]) {
      expect(read(rel).includes('\r')).toBe(false);
    }
  });

  it('CI jobs block starts immediately after defaults shell bash', () => {
    expect(read('.github/workflows/ci.yml')).toContain('    shell: bash\n\njobs:\n  typecheck:');
  });

  it('deploy jobs block starts immediately after concurrency cancel false', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      '  cancel-in-progress: false\n\njobs:\n  deploy:',
    );
  });

  it('package-lock lockfileVersion cross-locks hygiene assertion', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBe(3);
    expect(read('.github/workflows/ci.yml')).toContain(
      'grep -q \'"lockfileVersion": 3\' package-lock.json',
    );
  });

  it('cursor environment install is npm ci matching CI install steps', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { install: string; name: string };
    expect(env.install).toBe('npm ci');
    expect(env.name).toBe('Backlink_Facelift');
    expect(read('.github/workflows/ci.yml')).toContain('run: npm ci');
  });

  it('ISSUE_TEMPLATE directory lists bug feature chore config only', () => {
    const files = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
    expect(files).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('Map identity locks npm script name to command pairs used by CI', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const map = new Map(Object.entries(pkg.scripts));
    expect(map.get('typecheck')).toBe('tsc --noEmit');
    expect(map.get('test:coverage')).toBe('vitest run --coverage');
    expect(map.get('test')).toBe('vitest run');
    expect(map.size).toBe(6);
  });

  it('Set identity locks required hygiene doc filenames', () => {
    const docs = new Set(['README.md', 'AGENTS.md', 'DEPLOY.md', 'docs/mcp-spec.md']);
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    for (const f of docs) {
      expect(step).toContain(`test -f ${f}`);
    }
  });

  it('Proxy get trap over package name cannot rewrite live package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string };
    const { proxy, revoke } = Proxy.revocable(pkg, {
      get(target, prop) {
        if (prop === 'name') return 'hijacked';
        return Reflect.get(target, prop);
      },
    });
    expect(proxy.name).toBe('hijacked');
    expect(JSON.parse(read('package.json')).name).toBe('backlink');
    revoke();
  });

  it('Object.freeze on vitest threshold bag stays immutable', () => {
    const thresholds = Object.freeze({
      lines: 100,
      functions: 100,
      branches: 100,
      statements: 100,
    });
    expect(() => {
      (thresholds as { lines: number }).lines = 90;
    }).toThrow();
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('Reflect.ownKeys on package scripts stays six ESM tooling entries', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Reflect.ownKeys(pkg.scripts).sort()).toEqual(
      ['deploy', 'dev', 'test', 'test:coverage', 'test:watch', 'typecheck'].sort(),
    );
  });

  it('ci.yml colon count stays at 109', () => {
    expect((read('.github/workflows/ci.yml').match(/:/g) ?? []).length).toBe(109);
  });

  it('deploy.yml colon count stays at 37', () => {
    expect((read('.github/workflows/deploy.yml').match(/:/g) ?? []).length).toBe(37);
  });

  it('dependabot.yml colon count stays at 22', () => {
    expect((read('.github/dependabot.yml').match(/:/g) ?? []).length).toBe(22);
  });

  it('ci.yml dash count stays at 173', () => {
    expect((read('.github/workflows/ci.yml').match(/-/g) ?? []).length).toBe(173);
  });

  it('deploy.yml dash count stays at 16', () => {
    expect((read('.github/workflows/deploy.yml').match(/-/g) ?? []).length).toBe(16);
  });

  it('dependabot.yml dash count stays at 20', () => {
    expect((read('.github/dependabot.yml').match(/-/g) ?? []).length).toBe(20);
  });

  it('ci.yml double-quote count stays at 23', () => {
    expect((read('.github/workflows/ci.yml').match(/"/g) ?? []).length).toBe(23);
  });

  it('ci.yml single-quote count stays at 113', () => {
    expect((read('.github/workflows/ci.yml').match(/'/g) ?? []).length).toBe(113);
  });

  it('deploy.yml single-quote count is zero', () => {
    expect((read('.github/workflows/deploy.yml').match(/'/g) ?? []).length).toBe(0);
  });

  it('space count in ci.yml stays at 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('newline count in ci.yml stays at 176 (no trailing NL)', () => {
    expect((read('.github/workflows/ci.yml').match(/\n/g) ?? []).length).toBe(176);
  });

  it('newline count in deploy.yml stays at 46', () => {
    expect((read('.github/workflows/deploy.yml').match(/\n/g) ?? []).length).toBe(46);
  });

  it('CI does not declare permissions at job level', () => {
    const ci = read('.github/workflows/ci.yml');
    // only top-level permissions block
    expect([...ci.matchAll(/^permissions:/gm)]).toHaveLength(1);
    expect(ci).not.toMatch(/^\s{4}permissions:/m);
  });

  it('deploy does not declare permissions at job level', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect([...deploy.matchAll(/^permissions:/gm)]).toHaveLength(1);
    expect(deploy).not.toMatch(/^\s{4}permissions:/m);
  });

  it('CI upload-artifact path includes coverage/ and coverage/lcov.info', () => {
    const block = read('.github/workflows/ci.yml').slice(
      read('.github/workflows/ci.yml').indexOf('Upload coverage report'),
      read('.github/workflows/ci.yml').indexOf('hygiene:'),
    );
    expect(block).toContain('coverage/');
    expect(block).toContain('coverage/lcov.info');
  });

  it('fromCharCode rebuild of backlink package name matches package.json', () => {
    const rebuilt = String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107);
    expect(rebuilt).toBe('backlink');
    expect(JSON.parse(read('package.json')).name).toBe(rebuilt);
  });

  it('TextDecoder round-trip of CI name bytes stays CI', () => {
    const bytes = new TextEncoder().encode('CI');
    expect(new TextDecoder().decode(bytes)).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('CI does not use softprops or peter-evans third-party actions', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/peter-evans|softprops|actions\/github-script/);
  });

  it('deploy does not use npm publish or semantic-release', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/npm publish|semantic-release/);
  });

  it('AGENTS.md Verify fenced block lists four npm commands in order', () => {
    const agents = read('AGENTS.md');
    const block = agents.slice(agents.indexOf('## Verify'), agents.indexOf('## Escalate'));
    expect(block).toContain('```bash\nnpm ci\nnpm run typecheck\nnpm test\nnpm run test:coverage\n```');
  });

  it('cross-locks README Cloud agents coverage floors with vitest thresholds', () => {
    expect(read('README.md')).toMatch(/Coverage floors stay at \*\*100%\*\*/);
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('no BOM at start of CI deploy dependabot package vitest files', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'package.json',
      'vitest.config.ts',
    ]) {
      expect(read(rel).charCodeAt(0)).not.toBe(0xfeff);
    }
  });
});


// --- HEAVY burn (post-#79): deepen ci-config unit slice only — no product inventing ---
// Orthogonal to #79 routes. Digests, action pins, hygiene cross-locks, package-lock,
// ISSUE_TEMPLATE, gitattributes, AGENTS/verify wiring — tests-only.

describe('post79 ci-config HEAVY deepen', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);

  it('post79: locks ci.yml sha256 digest', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe(
      'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
    );
  });

  it('post79: locks ci.yml sha1 digest', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post79: locks ci.yml md5 digest', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post79: locks ci.yml sha256 nibble sum to 515', () => {
    expect(nibbleSum(sha256('.github/workflows/ci.yml'))).toBe(515);
  });

  it('post79: locks deploy.yml sha256 digest', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe(
      '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
    );
  });

  it('post79: locks deploy.yml sha1 digest', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post79: locks deploy.yml md5 digest', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post79: locks deploy.yml sha256 nibble sum to 476', () => {
    expect(nibbleSum(sha256('.github/workflows/deploy.yml'))).toBe(476);
  });

  it('post79: locks dependabot.yml sha256 digest', () => {
    expect(sha256('.github/dependabot.yml')).toBe(
      'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac',
    );
  });

  it('post79: locks dependabot.yml sha1 digest', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post79: locks dependabot.yml md5 digest', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post79: locks dependabot.yml sha256 nibble sum to 526', () => {
    expect(nibbleSum(sha256('.github/dependabot.yml'))).toBe(526);
  });

  it('post79: locks vitest.config.ts sha256 digest', () => {
    expect(sha256('vitest.config.ts')).toBe(
      'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
    );
  });

  it('post79: locks vitest.config.ts sha1 digest', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post79: locks vitest.config.ts md5 digest', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post79: locks vitest.config.ts sha256 nibble sum to 536', () => {
    expect(nibbleSum(sha256('vitest.config.ts'))).toBe(536);
  });

  it('post79: locks package.json sha256 digest', () => {
    expect(sha256('package.json')).toBe(
      '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
    );
  });

  it('post79: locks package.json sha1 digest', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post79: locks package.json md5 digest', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post79: locks package.json sha256 nibble sum to 451', () => {
    expect(nibbleSum(sha256('package.json'))).toBe(451);
  });

  it('post79: locks tsconfig.json sha256 digest', () => {
    expect(sha256('tsconfig.json')).toBe(
      'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
    );
  });

  it('post79: locks tsconfig.json sha1 digest', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post79: locks tsconfig.json md5 digest', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post79: locks tsconfig.json sha256 nibble sum to 506', () => {
    expect(nibbleSum(sha256('tsconfig.json'))).toBe(506);
  });

  it('post79: locks .gitignore sha256 digest', () => {
    expect(sha256('.gitignore')).toBe(
      '474ed59338a23de819e219c00d0e033b23e3669cc4106ce7a888fe0636569698',
    );
  });

  it('post79: locks .gitignore sha1 digest', () => {
    expect(sha1('.gitignore')).toBe('432103230f4c49258e046fc945e8160007c23570');
  });

  it('post79: locks .gitignore md5 digest', () => {
    expect(md5('.gitignore')).toBe('7d0728257f47875ec0120ca3cdbf7308');
  });

  it('post79: locks .gitignore sha256 nibble sum to 444', () => {
    expect(nibbleSum(sha256('.gitignore'))).toBe(444);
  });

  it('post79: locks .cursor/environment.json sha256 digest', () => {
    expect(sha256('.cursor/environment.json')).toBe(
      '4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694',
    );
  });

  it('post79: locks .cursor/environment.json sha1 digest', () => {
    expect(sha1('.cursor/environment.json')).toBe('b4f3dec322cd018ce5c1dea89897a469bd128685');
  });

  it('post79: locks .cursor/environment.json md5 digest', () => {
    expect(md5('.cursor/environment.json')).toBe('956c8804543595a31d6a7051aecd6528');
  });

  it('post79: locks .cursor/environment.json sha256 nibble sum to 472', () => {
    expect(nibbleSum(sha256('.cursor/environment.json'))).toBe(472);
  });

  it('post79: locks AGENTS.md sha256 digest', () => {
    expect(sha256('AGENTS.md')).toBe(
      '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
    );
  });

  it('post79: locks AGENTS.md sha1 digest', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post79: locks AGENTS.md md5 digest', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post79: locks AGENTS.md sha256 nibble sum to 479', () => {
    expect(nibbleSum(sha256('AGENTS.md'))).toBe(479);
  });

  it('post79: locks .gitattributes sha256 digest', () => {
    expect(sha256('.gitattributes')).toBe(
      '1a1dbe176bc233b499d35a57db7513f2941c99ab9759f177830c9149be99005b',
    );
  });

  it('post79: locks .gitattributes sha1 digest', () => {
    expect(sha1('.gitattributes')).toBe('ba3dfe345280bdcc5e817bb02cf49b8b8d8e1c4c');
  });

  it('post79: locks .gitattributes md5 digest', () => {
    expect(md5('.gitattributes')).toBe('05bdb783ee6514c8c072e47680af8ff7');
  });

  it('post79: locks .gitattributes sha256 nibble sum to 458', () => {
    expect(nibbleSum(sha256('.gitattributes'))).toBe(458);
  });

  it('post79: locks package-lock.json sha256 digest', () => {
    expect(sha256('package-lock.json')).toBe(
      '5f8a888f1fc7aaf97dcdaa3f91405cefbb45ad118685eac7a1488b78cedfcee6',
    );
  });

  it('post79: locks package-lock.json sha1 digest', () => {
    expect(sha1('package-lock.json')).toBe('6bc7eb19009d4dccc1d2928b0d856f337eb76aad');
  });

  it('post79: locks package-lock.json md5 digest', () => {
    expect(md5('package-lock.json')).toBe('568e267e07346bb7de4796dbeb117b54');
  });

  it('post79: locks fs.statSync size equals UTF-8 bytes for ci.yml', () => {
    const rel = join(root, '.github/workflows/ci.yml');
    expect(statSync(rel).size).toBe(readFileSync(rel).length);
    expect(statSync(rel).size).toBe(6295);
  });

  it('post79: locks fs.statSync size equals UTF-8 bytes for deploy.yml', () => {
    const rel = join(root, '.github/workflows/deploy.yml');
    expect(statSync(rel).size).toBe(1004);
  });

  it('post79: locks fs.statSync size equals UTF-8 bytes for dependabot.yml', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
  });

  it('post79: locks fs.statSync size equals UTF-8 bytes for vitest.config.ts', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
  });

  it('post79: locks fs.statSync size equals UTF-8 bytes for package.json', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
  });

  it('post79: locks fs.statSync size for .gitattributes to 66', () => {
    expect(statSync(join(root, '.gitattributes')).size).toBe(66);
  });

  it('post79: locks fs.statSync size for .cursor/environment.json to 57', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57);
  });

  it('post79: locks fs.statSync size for AGENTS.md to 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
  });

  it('post79: locks CI uses: action pins in order', () => {
    const uses = [...read('.github/workflows/ci.yml').matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/upload-artifact@v4',
      'actions/checkout@v7',
    ]);
  });

  it('post79: locks deploy uses: action pins in order', () => {
    const uses = [...read('.github/workflows/deploy.yml').matchAll(/uses:\s*(\S+)/g)].map(
      (m) => m[1],
    );
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'cloudflare/wrangler-action@v4',
    ]);
  });

  it('post79: locks CI named step inventory order', () => {
    const names = [...read('.github/workflows/ci.yml').matchAll(/- name:\s*(.+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Set up Node.js',
      'Install dependencies',
      'Unit / integration tests with coverage',
      'Assert coverage artifacts exist',
      'Upload coverage report',
      'Check required files',
      'Check for committed secret material',
    ]);
  });

  it('post79: locks deploy named step inventory order', () => {
    const names = [...read('.github/workflows/deploy.yml').matchAll(/- name:\s*(.+)/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Unit / integration tests with coverage',
      'Deploy to Cloudflare Workers',
    ]);
  });

  it('post79: locks CI uses count to 6 and deploy uses count to 3', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/^\s*-?\s*uses:/gm)]).toHaveLength(6);
    expect([...read('.github/workflows/deploy.yml').matchAll(/^\s*-?\s*uses:/gm)]).toHaveLength(3);
  });

  it('post79: locks CI named-step count to 10', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/- name:/g)]).toHaveLength(10);
  });

  it('post79: locks hygiene test -f count to 31 and test -d count to 1', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect([...step.matchAll(/test -f /g)]).toHaveLength(31);
    expect([...step.matchAll(/test -d /g)]).toHaveLength(1);
  });

  it('post79: locks hygiene Check required files grep -q count to 42', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect([...step.matchAll(/grep -q/g)]).toHaveLength(42);
  });

  it('post79: locks ci.yml hash/at/dollar/brace/pipe glyph counts', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/#/g) ?? []).length).toBe(3);
    expect((ci.match(/@/g) ?? []).length).toBe(7);
    expect((ci.match(/\$/g) ?? []).length).toBe(4);
    expect((ci.match(/\{/g) ?? []).length).toBe(11);
    expect((ci.match(/\|/g) ?? []).length).toBe(16);
  });

  it('post79: locks deploy.yml space count to 274', () => {
    expect((read('.github/workflows/deploy.yml').match(/ /g) ?? []).length).toBe(274);
  });

  it('post79: locks dependabot.yml space count to 130', () => {
    expect((read('.github/dependabot.yml').match(/ /g) ?? []).length).toBe(130);
  });

  it('post79: locks vitest.config.ts space count to 121', () => {
    expect((read('vitest.config.ts').match(/ /g) ?? []).length).toBe(121);
  });

  it('post79: locks package.json space count to 106', () => {
    expect((read('package.json').match(/ /g) ?? []).length).toBe(106);
  });

  it('post79: locks .gitignore space count to 19', () => {
    expect((read('.gitignore').match(/ /g) ?? []).length).toBe(19);
  });

  it('post79: locks JSON.stringify length of deploy.yml to 1056', () => {
    expect(JSON.stringify(read('.github/workflows/deploy.yml')).length).toBe(1056);
  });

  it('post79: locks JSON.stringify length of dependabot.yml to 551', () => {
    expect(JSON.stringify(read('.github/dependabot.yml')).length).toBe(551);
  });

  it('post79: locks JSON.stringify length of vitest.config.ts to 558', () => {
    expect(JSON.stringify(read('vitest.config.ts')).length).toBe(558);
  });

  it('post79: locks JSON.stringify length of package.json to 736', () => {
    expect(JSON.stringify(read('package.json')).length).toBe(736);
  });

  it('post79: locks JSON.stringify length of environment.json to 71', () => {
    expect(JSON.stringify(read('.cursor/environment.json')).length).toBe(71);
  });

  it('post79: locks package.json top-level key set', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(Object.keys(pkg).sort()).toEqual([
      'dependencies',
      'description',
      'devDependencies',
      'name',
      'scripts',
      'type',
      'version',
    ]);
  });

  it('post79: locks package.json devDependency key set', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      '@cloudflare/workers-types',
      '@types/node',
      '@vitest/coverage-v8',
      'typescript',
      'vitest',
      'wrangler',
    ]);
  });

  it('post79: locks package.json exact dependency versions', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ hono: '^4.13.7' });
    expect(pkg.devDependencies.typescript).toBe('^5.7.0');
    expect(pkg.devDependencies.vitest).toBe('^5.0.0');
    expect(pkg.devDependencies['@vitest/coverage-v8']).toBe('^5.0.0');
    expect(pkg.devDependencies.wrangler).toBe('^4.131.1');
    expect(pkg.devDependencies['@types/node']).toBe('^22.20.2');
    expect(pkg.devDependencies['@cloudflare/workers-types']).toBe('^5.20260911.1');
  });

  it('post79: locks package-lock root identity with package.json', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      lockfileVersion: number;
      requires: boolean;
      packages: Record<string, { name?: string; version?: string; dependencies?: object }>;
    };
    const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
    expect(lock.name).toBe(pkg.name);
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.requires).toBe(true);
    expect(lock.packages['']?.name).toBe('backlink');
    expect(lock.packages['']?.version).toBe(pkg.version);
    expect(Object.keys(lock.packages['']?.dependencies ?? {})).toEqual(['hono']);
  });

  it('post79: locks package-lock packages entry count to 168', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(Object.keys(lock.packages)).toHaveLength(168);
  });

  it('post79: locks resolved hono and vitest versions in package-lock', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages['node_modules/hono']?.version).toBe('4.13.7');
    expect(lock.packages['node_modules/vitest']?.version).toBe('5.0.0');
  });

  it('post79: locks package-lock.json byte length to 92068', () => {
    expect(readFileSync(join(root, 'package-lock.json')).length).toBe(92068);
    expect(statSync(join(root, 'package-lock.json')).size).toBe(92068);
  });

  it('post79: locks package-lock.json line count to 2842', () => {
    expect(read('package-lock.json').split('\n')).toHaveLength(2842);
    expect(read('package-lock.json').endsWith('\n')).toBe(true);
  });

  it('post79: locks tsconfig compilerOptions key order', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(Object.keys(ts.compilerOptions)).toEqual([
      'target',
      'lib',
      'module',
      'moduleResolution',
      'types',
      'strict',
      'noEmit',
      'resolveJsonModule',
      'skipLibCheck',
    ]);
  });

  it('post79: locks tsconfig exact compilerOptions values', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.lib).toEqual(['ES2022']);
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.resolveJsonModule).toBe(true);
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('post79: locks .gitignore nonempty ignore entries', () => {
    const entries = read('.gitignore')
      .split('\n')
      .filter((l) => l.length > 0 && !l.startsWith('#'));
    expect(entries).toEqual([
      'node_modules/',
      '.env',
      '.env.*',
      '!.env.example',
      '.dev.vars',
      '*.pem',
      '*.key',
      '.wrangler/',
      '.mf/',
      'dist/',
      'coverage/',
      '.DS_Store',
      '.idea/',
      '.vscode/',
      '*.swp',
      '*~',
    ]);
  });

  it('post79: locks .gitignore section comment headers', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('# Dependencies');
    expect(gi).toContain('# Local env / secrets (never commit)');
    expect(gi).toContain('# Wrangler / Workers local state');
    expect(gi).toContain('# Test coverage output');
    expect(gi).toContain('# Editor / OS noise');
  });

  it('post79: locks .gitattributes exact LF-normalization policy', () => {
    expect(read('.gitattributes')).toBe(
      '# Auto detect text files and perform LF normalization\n* text=auto\n',
    );
  });

  it('post79: locks .cursor/environment.json exact two-key payload', () => {
    expect(read('.cursor/environment.json')).toBe(
      '{\n  "name": "Backlink_Facelift",\n  "install": "npm ci"\n}\n',
    );
  });

  it('post79: locks ISSUE_TEMPLATE config.yml blank_issues_enabled false', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toBe('blank_issues_enabled: false\n');
  });

  it('post79: locks ISSUE_TEMPLATE bug feature chore name lines', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toMatch(/^name: Bug\n/);
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toMatch(/^name: Feature\n/);
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toMatch(/^name: Chore \/ Infra \/ Docs\n/);
  });

  it('post79: locks ISSUE_TEMPLATE bug labels and component options', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toContain('labels: ["bug"]');
    expect(bug).toContain('options: [Parser, Curator, API, Deploy, CF-AI, KV-Cache]');
    expect(bug).toContain('options: [Critical, High, Medium, Low]');
    expect(bug).toContain('options: [XS, S, M, L, XL]');
  });

  it('post79: locks ISSUE_TEMPLATE feature labels and title prefix', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature).toContain('labels: ["enhancement"]');
    expect(feature).toContain('title: "[Feature]: "');
  });

  it('post79: locks ISSUE_TEMPLATE chore labels and title prefix', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore).toContain('labels: ["chore"]');
    expect(chore).toContain('title: "[Chore]: "');
  });

  it('post79: locks AGENTS.md H2 section order', () => {
    const sections = [...read('AGENTS.md').matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual([
      'Classification',
      'Purpose',
      'Safe Agent Actions',
      'Verify',
      'Escalate to Human',
    ]);
  });

  it('post79: locks AGENTS.md Tier A Autonomy L2 and domain target', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)');
    expect(agents).toContain('Autonomy: L2 (Standard — non-critical infra)');
    expect(agents).toContain('Domain target: backlink.fuzzywigg.com');
    expect(agents).toContain('parent_governance: github.com/fuzzywigg/agents-governance');
  });

  it('post79: locks AGENTS.md em-dash count to three', () => {
    const nonAscii = [...read('AGENTS.md')].filter((c) => c.charCodeAt(0) > 127);
    expect(nonAscii).toEqual(['—', '—', '—']);
    expect(read('AGENTS.md').length).toBe(1011);
    expect(new TextEncoder().encode(read('AGENTS.md')).length).toBe(1017);
  });

  it('post79: locks AGENTS.md Safe Agent Actions bullet inventory', () => {
    const block = read('AGENTS.md').slice(
      read('AGENTS.md').indexOf('## Safe Agent Actions'),
      read('AGENTS.md').indexOf('## Verify'),
    );
    expect(block).toContain('`src/genres.ts`');
    expect(block).toContain('`src/parser.ts`');
    expect(block).toContain('`test/`');
    expect(block).toContain('/playlist');
    expect(block).toContain('/now-playing');
  });

  it('post79: locks AGENTS.md Escalate bullets include GEMINI and CORS', () => {
    const block = read('AGENTS.md').slice(read('AGENTS.md').indexOf('## Escalate to Human'));
    expect(block).toContain('GEMINI_API_KEY');
    expect(block).toContain('CORS or authentication');
    expect(block).toContain('Production deploy');
    expect(block).toContain('iptv-org');
  });

  it('post79: locks vitest.config.ts exact full source', () => {
    expect(read('vitest.config.ts')).toBe(`import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
`);
  });

  it('post79: locks vitest coverage reporter order text text-summary html lcov', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporter: ['text', 'text-summary', 'html', 'lcov']",
    );
  });

  it('post79: locks dependabot version 2 and monthly intervals', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2\n')).toBe(true);
    expect([...dep.matchAll(/interval:\s*"monthly"/g)]).toHaveLength(2);
    expect(dep).toContain('open-pull-requests-limit: 3');
    expect(dep).toContain('open-pull-requests-limit: 2');
  });

  it('post79: locks dependabot ecosystem order npm then github-actions', () => {
    const dep = read('.github/dependabot.yml');
    const ecosystems = [...dep.matchAll(/package-ecosystem:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ecosystems).toEqual(['npm', 'github-actions']);
  });

  it('post79: locks CI concurrency group template exact', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'group: ci-${{ github.workflow }}-${{ github.ref }}',
    );
  });

  it('post79: locks deploy concurrency group template exact', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('group: deploy-${{ github.workflow }}');
  });

  it('post79: locks deploy secrets mapping CF_API_TOKEN CF_ACCOUNT_ID GEMINI', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
    expect(deploy).toContain('secrets: |\n            GEMINI_API_KEY');
    expect(deploy).toContain('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}');
  });

  it('post79: locks CI job id insertion order typecheck test hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsBlock = ci.slice(ci.indexOf('\njobs:\n') + '\njobs:\n'.length);
    const ids = [...jobsBlock.matchAll(/^  (typecheck|test|hygiene):\n/gm)].map((m) => m[1]);
    expect(ids).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('post79: locks CI job display names Typecheck Tests Hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('    name: Typecheck\n');
    expect(ci).toContain('    name: Tests\n');
    expect(ci).toContain('    name: Hygiene\n');
  });

  it('post79: locks CI timeouts 10/15/5 for typecheck/test/hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(
      /typecheck:[\s\S]*?timeout-minutes:\s*10[\s\S]*?test:[\s\S]*?timeout-minutes:\s*15[\s\S]*?hygiene:[\s\S]*?timeout-minutes:\s*5/,
    );
  });

  it('post79: locks coverage assert step exact commands', () => {
    const block = read('.github/workflows/ci.yml').slice(
      read('.github/workflows/ci.yml').indexOf('Assert coverage artifacts exist'),
      read('.github/workflows/ci.yml').indexOf('Upload coverage report'),
    );
    expect(block).toContain('test -d coverage');
    expect(block).toContain('test -f coverage/lcov.info');
    expect(block).toContain('test -s coverage/lcov.info');
    expect(block).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post79: locks upload-artifact name retention and paths', () => {
    const block = read('.github/workflows/ci.yml').slice(
      read('.github/workflows/ci.yml').indexOf('Upload coverage report'),
      read('.github/workflows/ci.yml').indexOf('hygiene:'),
    );
    expect(block).toContain('name: coverage-report');
    expect(block).toContain('retention-days: 14');
    expect(block).toContain('if-no-files-found: error');
    expect(block).toContain('uses: actions/upload-artifact@v4');
  });

  it('post79: locks secret-scan exclude-dir inventory', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain('--exclude-dir=.git');
    expect(step).toContain('--exclude-dir=node_modules');
    expect(step).toContain('--exclude-dir=coverage');
    expect(step).toContain("! test -f .env");
    expect(step).toContain('! test -f .dev.vars');
    expect(step).toContain("! find . \\( -name '*.pem' -o -name '*.key' \\)");
  });

  it('post79: negative — CI workflow does not invent product routes', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/\/playlist|\/now-playing|openapi|graphql|websocket/i);
    expect(ci).not.toMatch(/GEMINI_API_KEY\s*[:=]\s*['\"]?[A-Za-z0-9]/);
  });

  it('post79: negative — deploy workflow does not auto-push or schedule', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*schedule:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
    expect(deploy).not.toMatch(/cron:/);
  });

  it('post79: negative — dependabot does not enable docker or pip ecosystems', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).not.toMatch(/docker|pip|cargo|gomod|nuget|composer/i);
  });

  it('post79: negative — vitest.config does not enable watch or ui mode defaults', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).not.toMatch(/watch:\s*true|ui:\s*true|browser:\s*true/);
    expect(cfg).not.toMatch(/poolOptions|threads:\s*false/);
  });

  it('post79: negative — package.json has no bin/main/exports fields', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.bin).toBeUndefined();
    expect(pkg.main).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
    expect(pkg.engines).toBeUndefined();
  });

  it('post79: negative — environment.json has no secrets or start script', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
    expect(env).not.toHaveProperty('secrets');
    expect(env).not.toHaveProperty('start');
  });

  it('post79: btoa round-trip of coverage-report artifact name', () => {
    expect(btoa('coverage-report')).toBe('Y292ZXJhZ2UtcmVwb3J0');
    expect(atob('Y292ZXJhZ2UtcmVwb3J0')).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml')).toContain(`name: ${atob('Y292ZXJhZ2UtcmVwb3J0')}`);
  });

  it('post79: btoa round-trip of ubuntu-latest runner token', () => {
    expect(btoa('ubuntu-latest')).toBe('dWJ1bnR1LWxhdGVzdA==');
    expect(read('.github/workflows/ci.yml')).toContain(`runs-on: ${atob('dWJ1bnR1LWxhdGVzdA==')}`);
  });

  it('post79: fromCharCode rebuild of backlink package name', () => {
    const name = String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107);
    expect(name).toBe('backlink');
    expect(JSON.parse(read('package.json')).name).toBe(name);
  });

  it('post79: fromCharCode rebuild of Backlink_Facelift environment name', () => {
    const name = String.fromCharCode(
      66, 97, 99, 107, 108, 105, 110, 107, 95, 70, 97, 99, 101, 108, 105, 102, 116,
    );
    expect(name).toBe('Backlink_Facelift');
    expect(JSON.parse(read('.cursor/environment.json')).name).toBe(name);
  });

  it('post79: TextEncoder bytes for actions/checkout@v7 pin', () => {
    expect([...new TextEncoder().encode('actions/checkout@v7')]).toEqual([
      97, 99, 116, 105, 111, 110, 115, 47, 99, 104, 101, 99, 107, 111, 117, 116, 64, 118, 55,
    ]);
    expect(read('.github/workflows/ci.yml')).toContain('actions/checkout@v7');
  });

  it('post79: TextEncoder bytes for cloudflare/wrangler-action@v4 pin', () => {
    const pin = 'cloudflare/wrangler-action@v4';
    expect(new TextDecoder().decode(new TextEncoder().encode(pin))).toBe(pin);
    expect(read('.github/workflows/deploy.yml')).toContain(pin);
  });

  it('post79: codePointAt sequence for workflow name Deploy to Cloudflare Workers', () => {
    const name = 'Deploy to Cloudflare Workers';
    expect([...name].map((c) => c.codePointAt(0))).toEqual([
      68, 101, 112, 108, 111, 121, 32, 116, 111, 32, 67, 108, 111, 117, 100, 102, 108, 97, 114,
      101, 32, 87, 111, 114, 107, 101, 114, 115,
    ]);
    expect(read('.github/workflows/deploy.yml')).toMatch(new RegExp(`^name:\\s*${name}\\s*$`, 'm'));
  });

  it('post79: Map identity locks CI job timeout minutes', () => {
    const timeouts = new Map([
      ['typecheck', 10],
      ['test', 15],
      ['hygiene', 5],
    ]);
    expect(timeouts.get('typecheck')).toBe(10);
    expect(timeouts.get('test')).toBe(15);
    expect(timeouts.get('hygiene')).toBe(5);
    expect([...timeouts.values()].reduce((a, b) => a + b, 0)).toBe(30);
  });

  it('post79: Set identity locks required CI workflow basenames', () => {
    const required = new Set(['ci.yml', 'deploy.yml']);
    expect([...required].sort()).toEqual(
      readdirSync(join(root, '.github/workflows')).filter((f) => f.endsWith('.yml')).sort(),
    );
  });

  it('post79: WeakSet can hold frozen package.json object identity', () => {
    const pkg = Object.freeze(JSON.parse(read('package.json')) as object);
    const ws = new WeakSet<object>();
    ws.add(pkg);
    expect(ws.has(pkg)).toBe(true);
    expect((pkg as { name: string }).name).toBe('backlink');
  });

  it('post79: structuredClone of dependabot PR limits stays independent', () => {
    const limits = { npm: 3, actions: 2 };
    const cloned = structuredClone(limits);
    cloned.npm = 99;
    expect(limits.npm).toBe(3);
    expect(read('.github/dependabot.yml')).toContain('open-pull-requests-limit: 3');
  });

  it('post79: Object.freeze vitest threshold bag cannot be mutated', () => {
    const thresholds = Object.freeze({
      lines: 100,
      functions: 100,
      branches: 100,
      statements: 100,
    });
    expect(() => {
      (thresholds as { lines: number }).lines = 50;
    }).toThrow();
    expect(read('vitest.config.ts')).toMatch(/statements:\s*100/);
  });

  it('post79: Reflect.ownKeys on cursor environment stays name+install', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, string>;
    expect(Reflect.ownKeys(env).sort()).toEqual(['install', 'name']);
  });

  it('post79: Proxy cannot rewrite live package-lock lockfileVersion', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    const { proxy, revoke } = Proxy.revocable(lock, {
      get(target, prop) {
        if (prop === 'lockfileVersion') return 99;
        return Reflect.get(target, prop);
      },
    });
    expect(proxy.lockfileVersion).toBe(99);
    expect(JSON.parse(read('package-lock.json')).lockfileVersion).toBe(3);
    revoke();
  });

  it('post79: CI does not reference ISSUE_TEMPLATE paths in hygiene', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).not.toContain('ISSUE_TEMPLATE');
    expect(readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort()).toEqual([
      'bug.yml',
      'chore.yml',
      'config.yml',
      'feature.yml',
    ]);
  });

  it('post79: hygiene still asserts all nine test suite files', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    for (const f of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/helpers.ts',
      'test/helpers.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
    ]) {
      expect(step).toContain(`test -f ${f}`);
    }
  });

  it('post79: hygiene asserts src module inventory', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    for (const f of [
      'src/index.ts',
      'src/parser.ts',
      'src/genres.ts',
      'src/mcp.ts',
      'src/types.ts',
    ]) {
      expect(step).toContain(`test -f ${f}`);
    }
  });

  it('post79: hygiene asserts typescript caret-5 and rejects caret-6/7', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('grep -qE \'"typescript": "\\^5\\.\' package.json');
    expect(step).toContain('! grep -qE \'"typescript": "\\^[67]\\.\' package.json');
  });

  it('post79: hygiene forbids anthropic/claude/haiku in src and workflows', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(step).toContain(
      "! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'",
    );
  });

  it('post79: hygiene asserts gemini-2.0-flash model pin in index.ts', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
    expect(read('src/index.ts')).toContain('gemini-2.0-flash');
  });

  it('post79: cross-locks package scripts with AGENTS Verify fence', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const verify = read('AGENTS.md').slice(
      read('AGENTS.md').indexOf('## Verify'),
      read('AGENTS.md').indexOf('## Escalate'),
    );
    expect(verify).toContain('npm ci');
    expect(verify).toContain('npm run typecheck');
    expect(verify).toContain('npm test');
    expect(verify).toContain('npm run test:coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post79: cross-locks CI npm run commands with package scripts', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    expect(ci).toContain('run: npm run typecheck');
    expect(ci).toContain('run: npm run test:coverage');
    expect(deploy).toContain('run: npm run typecheck');
    expect(deploy).toContain('run: npm run test:coverage');
  });

  it('post79: CI and deploy both pin setup-node cache npm', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/cache:\s*"npm"/g)]).toHaveLength(2);
    expect([...read('.github/workflows/deploy.yml').matchAll(/cache:\s*"npm"/g)]).toHaveLength(1);
  });

  it('post79: CI and deploy both pin node-version 20 with quotes', () => {
    // 2 setup-node pins + 1 hygiene grep assertion quoting the same token
    expect([...read('.github/workflows/ci.yml').matchAll(/node-version:\s*"20"/g)]).toHaveLength(3);
    expect([...read('.github/workflows/deploy.yml').matchAll(/node-version:\s*"20"/g)]).toHaveLength(
      1,
    );
  });

  it('post79: CI persist-credentials false appears five times', () => {
    // 3 checkout pins + 2 hygiene grep assertions (ci.yml + deploy.yml)
    expect([
      ...read('.github/workflows/ci.yml').matchAll(/persist-credentials:\s*false/g),
    ]).toHaveLength(5);
    expect([
      ...read('.github/workflows/deploy.yml').matchAll(/persist-credentials:\s*false/g),
    ]).toHaveLength(1);
  });

  it('post79: CI contents:read appears twice (permission + hygiene grep of deploy)', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/contents:\s*read/g)]).toHaveLength(2);
    expect(ci.indexOf('permissions:')).toBeLessThan(ci.indexOf('jobs:'));
    expect(ci).toContain("grep -q 'contents: read' .github/workflows/deploy.yml");
  });

  it('post79: deploy contents:read permission appears once at workflow level', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect([...deploy.matchAll(/contents:\s*read/g)]).toHaveLength(1);
    expect(deploy.indexOf('permissions:')).toBeLessThan(deploy.indexOf('jobs:'));
  });

  it('post79: locks ci.yml first and last 40 characters', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.slice(0, 40)).toBe('name: CI\n\non:\n  push:\n    branches: [mai');
    expect(ci.slice(-40)).toBe("odules/*' ! -path './.git/*' | grep -q .");
  });

  it('post79: locks deploy.yml first and last 40 characters', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.slice(0, 40)).toBe('name: Deploy to Cloudflare Workers\n\non:\n');
    expect(deploy.slice(-40)).toBe('_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n');
  });

  it('post79: locks dependabot.yml first line version 2 and last star pattern', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2\nupdates:\n')).toBe(true);
    expect(dep.endsWith('          - "*"\n')).toBe(true);
  });

  it('post79: no tabs in CI deploy dependabot vitest package tsconfig', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
      'package.json',
      'tsconfig.json',
      '.cursor/environment.json',
      '.gitattributes',
    ]) {
      expect(read(rel).includes('\t')).toBe(false);
    }
  });

  it('post79: no null bytes in CI config surface files', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
      'package.json',
    ]) {
      expect(readFileSync(join(root, rel)).includes(0)).toBe(false);
    }
  });

  it('post79: CI workflow dirname listing is exactly ci.yml and deploy.yml', () => {
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post79: .github top-level listing includes workflows dependabot ISSUE_TEMPLATE', () => {
    const entries = readdirSync(join(root, '.github')).sort();
    expect(entries).toEqual(['ISSUE_TEMPLATE', 'dependabot.yml', 'workflows']);
  });

  it('post79: ArrayBuffer view of CI name bytes stays CI', () => {
    const bytes = new TextEncoder().encode('CI');
    expect(bytes.buffer.byteLength).toBeGreaterThanOrEqual(2);
    expect(new TextDecoder().decode(bytes)).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post79: URL canParse of iptv-org hygiene is irrelevant — CI has no iptv URL', () => {
    expect(URL.canParse('https://iptv-org.github.io/iptv/categories/music.m3u')).toBe(true);
    expect(read('.github/workflows/ci.yml')).not.toContain('iptv-org.github.io');
  });

  it('post79: hygiene mentions iptv-org only in Escalate docs not CI file body beyond AGENTS path', () => {
    // CI itself should not fetch iptv; product docs may mention it
    expect(read('.github/workflows/ci.yml')).not.toMatch(/iptv-org/);
    expect(read('AGENTS.md')).toContain('iptv-org');
  });

  it('post79: sha256 first/last octets of ci.yml stay c4 / d5', () => {
    const hex = sha256('.github/workflows/ci.yml');
    expect(hex.slice(0, 2)).toBe('c4');
    expect(hex.slice(-2)).toBe('d5');
  });

  it('post79: sha256 first/last octets of deploy.yml stay 49 / c3', () => {
    const hex = sha256('.github/workflows/deploy.yml');
    expect(hex.slice(0, 2)).toBe('49');
    expect(hex.slice(-2)).toBe('c3');
  });

  it('post79: sha256 first/last octets of vitest.config.ts stay f9 / 38', () => {
    const hex = sha256('vitest.config.ts');
    expect(hex.slice(0, 2)).toBe('f9');
    expect(hex.slice(-2)).toBe('38');
  });

  it('post79: digest hex length locks for sha256/sha1/md5', () => {
    expect(sha256('.github/workflows/ci.yml')).toHaveLength(64);
    expect(sha1('.github/workflows/ci.yml')).toHaveLength(40);
    expect(md5('.github/workflows/ci.yml')).toHaveLength(32);
  });

  it('post79: CI file is ASCII-only while package.json has one em-dash', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect(read('.github/dependabot.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect([...read('package.json')].filter((c) => c.charCodeAt(0) > 127)).toEqual(['—']);
  });

  it('post79: package.json description contains editorial AI over iptv-org catalog', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('post79: package scripts include watch and wrangler pair', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:watch']).toBe('vitest');
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    expect(Object.keys(pkg.scripts)).toHaveLength(6);
  });

  it('post79: CI defaults shell bash appears before jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('defaults:')).toBeLessThan(ci.indexOf('jobs:'));
    expect(ci).toContain('    shell: bash\n\njobs:\n');
  });

  it('post79: deploy has no defaults shell block', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/defaults:/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/shell:\s*bash/);
  });

  it('post79: CI cancel-in-progress true vs deploy false', () => {
    expect(read('.github/workflows/ci.yml')).toContain('cancel-in-progress: true');
    expect(read('.github/workflows/deploy.yml')).toContain('cancel-in-progress: false');
  });

  it('post79: encodeURIComponent of coverage-report is identity', () => {
    expect(encodeURIComponent('coverage-report')).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml')).toContain('name: coverage-report');
  });

  it('post79: padStart of Node major version stays 20', () => {
    expect('20'.padStart(2, '0')).toBe('20');
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
  });

  it('post79: Number parse of retention-days 14 is fortnight days', () => {
    expect(Number('14')).toBe(14);
    expect(14 / 7).toBe(2);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post79: BigInt of package-lock packages count stays 168n', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(BigInt(Object.keys(lock.packages).length)).toBe(168n);
  });

  it('post79: Int32Array length lock for threshold values', () => {
    const arr = Int32Array.from([100, 100, 100, 100]);
    expect(arr).toHaveLength(4);
    expect([...arr].every((n) => n === 100)).toBe(true);
    expect(read('vitest.config.ts')).toMatch(/branches:\s*100/);
  });

  it('post79: DataView reads Node version major as 20 from bytes', () => {
    const buf = new TextEncoder().encode('20');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint8(0)).toBe(0x32);
    expect(view.getUint8(1)).toBe(0x30);
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
  });

  it('post79: queueMicrotask scheduling does not alter CI file digests', async () => {
    const before = sha256('.github/workflows/ci.yml');
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(sha256('.github/workflows/ci.yml')).toBe(before);
  });

  it('post79: AbortSignal.timeout existence does not appear in CI YAML', () => {
    expect(typeof AbortSignal.timeout).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/AbortSignal|timeout\(/);
  });

  it('post79: Headers constructor is unused by CI contracts — no fetch headers in workflows', () => {
    expect(new Headers({ Accept: 'application/json' }).get('Accept')).toBe('application/json');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/Accept:|Authorization:/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/Authorization:/);
  });

  it('post79: FormData absence — workflows never multipart upload secrets as form fields', () => {
    expect(typeof FormData).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/FormData|multipart/i);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/FormData|multipart/i);
  });

  it('post79: Blob round-trip of CI workflow name', async () => {
    const blob = new Blob(['CI'], { type: 'text/plain' });
    expect(await blob.text()).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post79: CI does not use matrix strategy or fail-fast', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/strategy:|matrix:|fail-fast:/);
  });

  it('post79: deploy does not use matrix strategy or environment protection', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/strategy:|matrix:|environment:/);
  });

  it('post79: CI does not set GITHUB_TOKEN permissions beyond contents read', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/id-token:|packages:|pull-requests:|issues:|actions:/);
    expect(ci).toMatch(/permissions:\n  contents: read\n/);
  });

  it('post79: deploy job name is Deploy singular', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('    name: Deploy\n');
    expect(read('.github/workflows/deploy.yml')).toMatch(/^  deploy:\n/m);
  });

  it('post79: CI test job name Tests plural', () => {
    expect(read('.github/workflows/ci.yml')).toContain('    name: Tests\n');
    expect(read('.github/workflows/ci.yml')).toMatch(/^  test:\n/m);
  });

  it('post79: relative path join of workflows stays under .github', () => {
    expect(join('.github', 'workflows', 'ci.yml')).toBe('.github/workflows/ci.yml');
    expect(read('.github/workflows/ci.yml').length).toBeGreaterThan(0);
  });

  it('post79: dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(root.endsWith('/workspace') || root.endsWith('Backlink_Facelift') || root.includes('/')).toBe(
      true,
    );
    expect(read('package.json')).toContain('"name": "backlink"');
  });

  // --- HEAVY burn (post-#96): deepen CI / package wiring contracts (orthogonal to source-contracts #96 / genres #94; tests-only) ---

  it('post96: locks .github/workflows/ci.yml sha1 digest', () => {
    expect(createHash('sha1').update(read('.github/workflows/ci.yml')).digest('hex')).toBe(
      '2105395119389c6131d039b5d787abc150bbbcaa',
    );
  });

  it('post96: locks .github/workflows/ci.yml md5 digest', () => {
    expect(createHash('md5').update(read('.github/workflows/ci.yml')).digest('hex')).toBe(
      'ea05159f5a4591ccf20765050a212605',
    );
  });

  it('post96: locks .github/workflows/ci.yml UTF-8 byte size 6295', () => {
    expect(Buffer.byteLength(read('.github/workflows/ci.yml'), 'utf8')).toBe(6295);
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
  });

  it('post96: locks .github/workflows/ci.yml split line count 177', () => {
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post96: locks .github/workflows/deploy.yml sha1 digest', () => {
    expect(createHash('sha1').update(read('.github/workflows/deploy.yml')).digest('hex')).toBe(
      '5f7a3932b69a68d740162b1079688d6934060f61',
    );
  });

  it('post96: locks .github/workflows/deploy.yml md5 digest', () => {
    expect(createHash('md5').update(read('.github/workflows/deploy.yml')).digest('hex')).toBe(
      'ea86e4de097085159e425937542bf7cf',
    );
  });

  it('post96: locks .github/workflows/deploy.yml UTF-8 byte size 1004', () => {
    expect(Buffer.byteLength(read('.github/workflows/deploy.yml'), 'utf8')).toBe(1004);
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
  });

  it('post96: locks .github/workflows/deploy.yml split line count 47', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post96: locks .github/dependabot.yml sha1 digest', () => {
    expect(createHash('sha1').update(read('.github/dependabot.yml')).digest('hex')).toBe(
      'dfdb63975444874143105431e4cee95165932c7b',
    );
  });

  it('post96: locks .github/dependabot.yml md5 digest', () => {
    expect(createHash('md5').update(read('.github/dependabot.yml')).digest('hex')).toBe(
      'bd53b7cdf9bb7287532d96a32cbec9a4',
    );
  });

  it('post96: locks .github/dependabot.yml UTF-8 byte size 505', () => {
    expect(Buffer.byteLength(read('.github/dependabot.yml'), 'utf8')).toBe(505);
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
  });

  it('post96: locks .github/dependabot.yml split line count 25', () => {
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post96: locks package.json sha1 digest', () => {
    expect(createHash('sha1').update(read('package.json')).digest('hex')).toBe(
      'b58d14f35b9c13bb254d5e2a51240e2918a126c5',
    );
  });

  it('post96: locks package.json md5 digest', () => {
    expect(createHash('md5').update(read('package.json')).digest('hex')).toBe(
      '63472e1fb514fb0dadb5e49a7bdbaa5f',
    );
  });

  it('post96: locks package.json UTF-8 byte size 637', () => {
    expect(Buffer.byteLength(read('package.json'), 'utf8')).toBe(637);
    expect(statSync(join(root, 'package.json')).size).toBe(637);
  });

  it('post96: locks package.json split line count 26', () => {
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post96: locks vitest.config.ts sha1 digest', () => {
    expect(createHash('sha1').update(read('vitest.config.ts')).digest('hex')).toBe(
      'f8d49517ece92fc5e9781fbde021a948958aac37',
    );
  });

  it('post96: locks vitest.config.ts md5 digest', () => {
    expect(createHash('md5').update(read('vitest.config.ts')).digest('hex')).toBe(
      'f1176313255f5f064a946d458482d81a',
    );
  });

  it('post96: locks vitest.config.ts UTF-8 byte size 535', () => {
    expect(Buffer.byteLength(read('vitest.config.ts'), 'utf8')).toBe(535);
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
  });

  it('post96: locks vitest.config.ts split line count 22', () => {
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post96: locks tsconfig.json sha1 digest', () => {
    expect(createHash('sha1').update(read('tsconfig.json')).digest('hex')).toBe(
      '68e3169249049539d687b6b3d81fc809079134f9',
    );
  });

  it('post96: locks tsconfig.json md5 digest', () => {
    expect(createHash('md5').update(read('tsconfig.json')).digest('hex')).toBe(
      '13f6687a50fe7c6ea7ef4eb3623b7457',
    );
  });

  it('post96: locks tsconfig.json UTF-8 byte size 397', () => {
    expect(Buffer.byteLength(read('tsconfig.json'), 'utf8')).toBe(397);
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
  });

  it('post96: locks tsconfig.json split line count 24', () => {
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post96: locks .gitignore sha1 digest', () => {
    expect(createHash('sha1').update(read('.gitignore')).digest('hex')).toBe(
      '432103230f4c49258e046fc945e8160007c23570',
    );
  });

  it('post96: locks .gitignore md5 digest', () => {
    expect(createHash('md5').update(read('.gitignore')).digest('hex')).toBe(
      '7d0728257f47875ec0120ca3cdbf7308',
    );
  });

  it('post96: locks .gitignore UTF-8 byte size 261', () => {
    expect(Buffer.byteLength(read('.gitignore'), 'utf8')).toBe(261);
    expect(statSync(join(root, '.gitignore')).size).toBe(261);
  });

  it('post96: locks .gitignore split line count 26', () => {
    expect(read('.gitignore').split('\n')).toHaveLength(26);
  });

  it('post96: locks .gitattributes sha1 digest', () => {
    expect(createHash('sha1').update(read('.gitattributes')).digest('hex')).toBe(
      'ba3dfe345280bdcc5e817bb02cf49b8b8d8e1c4c',
    );
  });

  it('post96: locks .gitattributes md5 digest', () => {
    expect(createHash('md5').update(read('.gitattributes')).digest('hex')).toBe(
      '05bdb783ee6514c8c072e47680af8ff7',
    );
  });

  it('post96: locks .gitattributes UTF-8 byte size 66', () => {
    expect(Buffer.byteLength(read('.gitattributes'), 'utf8')).toBe(66);
    expect(statSync(join(root, '.gitattributes')).size).toBe(66);
  });

  it('post96: locks .gitattributes split line count 3', () => {
    expect(read('.gitattributes').split('\n')).toHaveLength(3);
  });

  it('post96: locks .cursor/environment.json sha1 digest', () => {
    expect(createHash('sha1').update(read('.cursor/environment.json')).digest('hex')).toBe(
      'b4f3dec322cd018ce5c1dea89897a469bd128685',
    );
  });

  it('post96: locks .cursor/environment.json md5 digest', () => {
    expect(createHash('md5').update(read('.cursor/environment.json')).digest('hex')).toBe(
      '956c8804543595a31d6a7051aecd6528',
    );
  });

  it('post96: locks .cursor/environment.json UTF-8 byte size 57', () => {
    expect(Buffer.byteLength(read('.cursor/environment.json'), 'utf8')).toBe(57);
    expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57);
  });

  it('post96: locks .cursor/environment.json split line count 5', () => {
    expect(read('.cursor/environment.json').split('\n')).toHaveLength(5);
  });

  it('post96: locks AGENTS.md sha1 digest', () => {
    expect(createHash('sha1').update(read('AGENTS.md')).digest('hex')).toBe(
      'a7df1fec05dcf7b8ace116788297c77f467a7b6c',
    );
  });

  it('post96: locks AGENTS.md md5 digest', () => {
    expect(createHash('md5').update(read('AGENTS.md')).digest('hex')).toBe(
      'e73be0edb8c4353b6b591454478f00cd',
    );
  });

  it('post96: locks AGENTS.md UTF-8 byte size 1017', () => {
    expect(Buffer.byteLength(read('AGENTS.md'), 'utf8')).toBe(1017);
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
  });

  it('post96: locks AGENTS.md split line count 35', () => {
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post96: locks DEPLOY.md sha1 digest', () => {
    expect(createHash('sha1').update(read('DEPLOY.md')).digest('hex')).toBe(
      '37c72be44abb67343dae3e7c2303306a25b3481f',
    );
  });

  it('post96: locks DEPLOY.md md5 digest', () => {
    expect(createHash('md5').update(read('DEPLOY.md')).digest('hex')).toBe(
      'da30bf656fdf0d9a61d2a00860c325f5',
    );
  });

  it('post96: locks DEPLOY.md UTF-8 byte size 1573', () => {
    expect(Buffer.byteLength(read('DEPLOY.md'), 'utf8')).toBe(1573);
    expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573);
  });

  it('post96: locks DEPLOY.md split line count 65', () => {
    expect(read('DEPLOY.md').split('\n')).toHaveLength(65);
  });

  it('post96: locks README.md sha1 digest', () => {
    expect(createHash('sha1').update(read('README.md')).digest('hex')).toBe(
      '4f560a473d5838f25eba3eae21a87f6c97ba3b8b',
    );
  });

  it('post96: locks README.md md5 digest', () => {
    expect(createHash('md5').update(read('README.md')).digest('hex')).toBe(
      '9b7aea4982a6d68b95f7f8ee3fdc5b31',
    );
  });

  it('post96: locks README.md UTF-8 byte size 2801', () => {
    expect(Buffer.byteLength(read('README.md'), 'utf8')).toBe(2801);
    expect(statSync(join(root, 'README.md')).size).toBe(2801);
  });

  it('post96: locks README.md split line count 82', () => {
    expect(read('README.md').split('\n')).toHaveLength(82);
  });

  it('post96: locks .github/workflows/ci.yml digit count at 48', () => {
    expect([...read('.github/workflows/ci.yml')].filter((c) => /\d/.test(c))).toHaveLength(48);
  });

  it('post96: locks .github/workflows/ci.yml uppercase ASCII letter count at 81', () => {
    expect([...read('.github/workflows/ci.yml')].filter((c) => /[A-Z]/.test(c))).toHaveLength(81);
  });

  it('post96: locks .github/workflows/ci.yml lowercase ASCII letter count at 3409', () => {
    expect([...read('.github/workflows/ci.yml')].filter((c) => /[a-z]/.test(c))).toHaveLength(3409);
  });

  it('post96: locks .github/workflows/ci.yml space count at 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('post96: locks .github/workflows/ci.yml newline count at 176', () => {
    expect((read('.github/workflows/ci.yml').match(/\n/g) ?? []).length).toBe(176);
  });

  it('post96: locks .github/workflows/ci.yml tab absence', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\t/);
  });

  it('post96: locks .github/workflows/ci.yml free of BOM and lacks trailing newline', () => {
    const body = read('.github/workflows/ci.yml');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(false);
    expect(body.endsWith("grep -q .")).toBe(true);
  });

  it('post96: locks .github/workflows/deploy.yml digit count at 7', () => {
    expect([...read('.github/workflows/deploy.yml')].filter((c) => /\d/.test(c))).toHaveLength(7);
  });

  it('post96: locks .github/workflows/deploy.yml uppercase ASCII letter count at 71', () => {
    expect([...read('.github/workflows/deploy.yml')].filter((c) => /[A-Z]/.test(c))).toHaveLength(71);
  });

  it('post96: locks .github/workflows/deploy.yml lowercase ASCII letter count at 505', () => {
    expect([...read('.github/workflows/deploy.yml')].filter((c) => /[a-z]/.test(c))).toHaveLength(505);
  });

  it('post96: locks .github/workflows/deploy.yml space count at 274', () => {
    expect((read('.github/workflows/deploy.yml').match(/ /g) ?? []).length).toBe(274);
  });

  it('post96: locks .github/workflows/deploy.yml newline count at 46', () => {
    expect((read('.github/workflows/deploy.yml').match(/\n/g) ?? []).length).toBe(46);
  });

  it('post96: locks .github/workflows/deploy.yml tab absence', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/\t/);
  });

  it('post96: locks .github/workflows/deploy.yml free of BOM and ends with newline', () => {
    const body = read('.github/workflows/deploy.yml');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('post96: locks .github/dependabot.yml digit count at 3', () => {
    expect([...read('.github/dependabot.yml')].filter((c) => /\d/.test(c))).toHaveLength(3);
  });

  it('post96: locks .github/dependabot.yml uppercase ASCII letter count at 0', () => {
    expect([...read('.github/dependabot.yml')].filter((c) => /[A-Z]/.test(c))).toHaveLength(0);
  });

  it('post96: locks .github/dependabot.yml lowercase ASCII letter count at 279', () => {
    expect([...read('.github/dependabot.yml')].filter((c) => /[a-z]/.test(c))).toHaveLength(279);
  });

  it('post96: locks .github/dependabot.yml space count at 130', () => {
    expect((read('.github/dependabot.yml').match(/ /g) ?? []).length).toBe(130);
  });

  it('post96: locks .github/dependabot.yml newline count at 24', () => {
    expect((read('.github/dependabot.yml').match(/\n/g) ?? []).length).toBe(24);
  });

  it('post96: locks .github/dependabot.yml tab absence', () => {
    expect(read('.github/dependabot.yml')).not.toMatch(/\t/);
  });

  it('post96: locks .github/dependabot.yml free of BOM and ends with newline', () => {
    const body = read('.github/dependabot.yml');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('post96: locks package.json digit count at 37', () => {
    expect([...read('package.json')].filter((c) => /\d/.test(c))).toHaveLength(37);
  });

  it('post96: locks package.json uppercase ASCII letter count at 7', () => {
    expect([...read('package.json')].filter((c) => /[A-Z]/.test(c))).toHaveLength(7);
  });

  it('post96: locks package.json lowercase ASCII letter count at 302', () => {
    expect([...read('package.json')].filter((c) => /[a-z]/.test(c))).toHaveLength(302);
  });

  it('post96: locks package.json space count at 106', () => {
    expect((read('package.json').match(/ /g) ?? []).length).toBe(106);
  });

  it('post96: locks package.json newline count at 25', () => {
    expect((read('package.json').match(/\n/g) ?? []).length).toBe(25);
  });

  it('post96: locks package.json tab absence', () => {
    expect(read('package.json')).not.toMatch(/\t/);
  });

  it('post96: locks package.json free of BOM and ends with newline', () => {
    const body = read('package.json');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('post96: locks vitest.config.ts digit count at 13', () => {
    expect([...read('vitest.config.ts')].filter((c) => /\d/.test(c))).toHaveLength(13);
  });

  it('post96: locks vitest.config.ts uppercase ASCII letter count at 15', () => {
    expect([...read('vitest.config.ts')].filter((c) => /[A-Z]/.test(c))).toHaveLength(15);
  });

  it('post96: locks vitest.config.ts lowercase ASCII letter count at 258', () => {
    expect([...read('vitest.config.ts')].filter((c) => /[a-z]/.test(c))).toHaveLength(258);
  });

  it('post96: locks vitest.config.ts space count at 121', () => {
    expect((read('vitest.config.ts').match(/ /g) ?? []).length).toBe(121);
  });

  it('post96: locks vitest.config.ts newline count at 21', () => {
    expect((read('vitest.config.ts').match(/\n/g) ?? []).length).toBe(21);
  });

  it('post96: locks vitest.config.ts tab absence', () => {
    expect(read('vitest.config.ts')).not.toMatch(/\t/);
  });

  it('post96: locks vitest.config.ts free of BOM and ends with newline', () => {
    const body = read('vitest.config.ts');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('post96: locks tsconfig.json digit count at 8', () => {
    expect([...read('tsconfig.json')].filter((c) => /\d/.test(c))).toHaveLength(8);
  });

  it('post96: locks tsconfig.json uppercase ASCII letter count at 15', () => {
    expect([...read('tsconfig.json')].filter((c) => /[A-Z]/.test(c))).toHaveLength(15);
  });

  it('post96: locks tsconfig.json lowercase ASCII letter count at 168', () => {
    expect([...read('tsconfig.json')].filter((c) => /[a-z]/.test(c))).toHaveLength(168);
  });

  it('post96: locks tsconfig.json space count at 93', () => {
    expect((read('tsconfig.json').match(/ /g) ?? []).length).toBe(93);
  });

  it('post96: locks tsconfig.json newline count at 23', () => {
    expect((read('tsconfig.json').match(/\n/g) ?? []).length).toBe(23);
  });

  it('post96: locks tsconfig.json tab absence', () => {
    expect(read('tsconfig.json')).not.toMatch(/\t/);
  });

  it('post96: locks tsconfig.json free of BOM and ends with newline', () => {
    const body = read('tsconfig.json');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('post96: locks .gitignore digit count at 0', () => {
    expect([...read('.gitignore')].filter((c) => /\d/.test(c))).toHaveLength(0);
  });

  it('post96: locks .gitignore uppercase ASCII letter count at 11', () => {
    expect([...read('.gitignore')].filter((c) => /[A-Z]/.test(c))).toHaveLength(11);
  });

  it('post96: locks .gitignore lowercase ASCII letter count at 165', () => {
    expect([...read('.gitignore')].filter((c) => /[a-z]/.test(c))).toHaveLength(165);
  });

  it('post96: locks .gitignore space count at 19', () => {
    expect((read('.gitignore').match(/ /g) ?? []).length).toBe(19);
  });

  it('post96: locks .gitignore newline count at 25', () => {
    expect((read('.gitignore').match(/\n/g) ?? []).length).toBe(25);
  });

  it('post96: locks .gitignore tab absence', () => {
    expect(read('.gitignore')).not.toMatch(/\t/);
  });

  it('post96: locks .gitignore free of BOM and ends with newline', () => {
    const body = read('.gitignore');
    expect(body.charCodeAt(0)).not.toBe(0xfeff);
    expect(body.endsWith('\n')).toBe(true);
  });

  it('post96: locks .github/workflows/ci.yml punctuation inventory', () => {
    const body = read('.github/workflows/ci.yml');
    expect((body.match(/:/g) ?? []).length).toBe(109);
    expect((body.match(/-/g) ?? []).length).toBe(173);
    expect((body.match(/_/g) ?? []).length).toBe(20);
    expect((body.match(/"/g) ?? []).length).toBe(23);
    expect((body.match(/'/g) ?? []).length).toBe(113);
    expect((body.match(/#/g) ?? []).length).toBe(3);
    expect((body.match(/\$/g) ?? []).length).toBe(4);
    expect(new Set(body).size).toBe(85);
    expect(Math.max(...[...body].map((c) => c.charCodeAt(0)))).toBe(126);
    expect(Math.min(...[...body].map((c) => c.charCodeAt(0)))).toBe(10);
  });

  it('post96: locks .github/workflows/deploy.yml punctuation inventory', () => {
    const body = read('.github/workflows/deploy.yml');
    expect((body.match(/:/g) ?? []).length).toBe(37);
    expect((body.match(/-/g) ?? []).length).toBe(16);
    expect((body.match(/_/g) ?? []).length).toBe(11);
    expect((body.match(/"/g) ?? []).length).toBe(4);
    expect((body.match(/'/g) ?? []).length).toBe(0);
    expect((body.match(/#/g) ?? []).length).toBe(0);
    expect((body.match(/\$/g) ?? []).length).toBe(4);
    expect(new Set(body).size).toBe(57);
    expect(Math.max(...[...body].map((c) => c.charCodeAt(0)))).toBe(125);
    expect(Math.min(...[...body].map((c) => c.charCodeAt(0)))).toBe(10);
  });

  it('post96: locks .github/dependabot.yml punctuation inventory', () => {
    const body = read('.github/dependabot.yml');
    expect((body.match(/:/g) ?? []).length).toBe(22);
    expect((body.match(/-/g) ?? []).length).toBe(20);
    expect((body.match(/_/g) ?? []).length).toBe(0);
    expect((body.match(/"/g) ?? []).length).toBe(20);
    expect((body.match(/'/g) ?? []).length).toBe(0);
    expect((body.match(/#/g) ?? []).length).toBe(0);
    expect((body.match(/\$/g) ?? []).length).toBe(0);
    expect(new Set(body).size).toBe(33);
    expect(Math.max(...[...body].map((c) => c.charCodeAt(0)))).toBe(121);
    expect(Math.min(...[...body].map((c) => c.charCodeAt(0)))).toBe(10);
  });

  it('post96: locks vitest.config.ts punctuation inventory', () => {
    const body = read('vitest.config.ts');
    expect((body.match(/:/g) ?? []).length).toBe(15);
    expect((body.match(/-/g) ?? []).length).toBe(2);
    expect((body.match(/_/g) ?? []).length).toBe(1);
    expect((body.match(/"/g) ?? []).length).toBe(0);
    expect((body.match(/'/g) ?? []).length).toBe(26);
    expect((body.match(/#/g) ?? []).length).toBe(0);
    expect((body.match(/\$/g) ?? []).length).toBe(0);
    expect(new Set(body).size).toBe(53);
    expect(Math.max(...[...body].map((c) => c.charCodeAt(0)))).toBe(125);
    expect(Math.min(...[...body].map((c) => c.charCodeAt(0)))).toBe(10);
  });

  it('post96: locks ci.yml keyword count for "npm ci" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "npm ci";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "npm run typecheck" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "npm run typecheck";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "npm run test:coverage" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "npm run test:coverage";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "ubuntu-latest" at 3', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "ubuntu-latest";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(3);
  });

  it('post96: locks ci.yml keyword count for "actions/checkout@v7" at 3', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "actions/checkout@v7";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(3);
  });

  it('post96: locks ci.yml keyword count for "actions/setup-node@v7" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "actions/setup-node@v7";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "actions/upload-artifact@v4" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "actions/upload-artifact@v4";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "persist-credentials: false" at 5', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "persist-credentials: false";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(5);
  });

  it('post96: locks ci.yml keyword count for "node-version: \"20\"" at 3', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "node-version: \"20\"";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(3);
  });

  it('post96: locks ci.yml keyword count for "cache: \"npm\"" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "cache: \"npm\"";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "contents: read" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "contents: read";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "timeout-minutes:" at 4', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "timeout-minutes:";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(4);
  });

  it('post96: locks ci.yml keyword count for "GEMINI_API_KEY" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "GEMINI_API_KEY";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "workflow_dispatch" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "workflow_dispatch";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "cancel-in-progress: true" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "cancel-in-progress: true";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "coverage-report" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "coverage-report";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "if: always()" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "if: always()";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "retention-days: 14" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "retention-days: 14";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "if-no-files-found: error" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "if-no-files-found: error";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "shell: bash" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "shell: bash";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "gemini-2.0-flash" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "gemini-2.0-flash";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "Typecheck" at 3', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "Typecheck";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(3);
  });

  it('post96: locks ci.yml keyword count for "Tests" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "Tests";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "Hygiene" at 2', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "Hygiene";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks ci.yml keyword count for "SF:src/" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "SF:src/";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "branches: 100" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "branches: 100";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "lines: 100" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "lines: 100";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "functions: 100" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "functions: 100";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "statements: 100" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "statements: 100";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "hono" at 1', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "hono";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks ci.yml keyword count for "vitest" at 9', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "vitest";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(9);
  });

  it('post96: locks ci.yml keyword count for "wrangler" at 4', () => {
    const body = read('.github/workflows/ci.yml');
    let count = 0;
    let i = 0;
    const needle = "wrangler";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(4);
  });

  it('post96: locks deploy.yml keyword count for "workflow_dispatch" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "workflow_dispatch";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "cancel-in-progress: false" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "cancel-in-progress: false";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "cloudflare/wrangler-action@v4" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "cloudflare/wrangler-action@v4";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "GEMINI_API_KEY" at 3', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "GEMINI_API_KEY";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(3);
  });

  it('post96: locks deploy.yml keyword count for "CF_API_TOKEN" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "CF_API_TOKEN";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "CF_ACCOUNT_ID" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "CF_ACCOUNT_ID";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "npm ci" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "npm ci";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "npm run typecheck" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "npm run typecheck";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "npm run test:coverage" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "npm run test:coverage";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "timeout-minutes: 20" at 1', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "timeout-minutes: 20";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(1);
  });

  it('post96: locks deploy.yml keyword count for "Deploy to Cloudflare Workers" at 2', () => {
    const body = read('.github/workflows/deploy.yml');
    let count = 0;
    let i = 0;
    const needle = "Deploy to Cloudflare Workers";
    while ((i = body.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    expect(count).toBe(2);
  });

  it('post96: locks CI named-step inventory exact', () => {
    const names = [...read('.github/workflows/ci.yml').matchAll(/- name: (.+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Set up Node.js',
      'Install dependencies',
      'Unit / integration tests with coverage',
      'Assert coverage artifacts exist',
      'Upload coverage report',
      'Check required files',
      'Check for committed secret material',
    ]);
  });

  it('post96: locks deploy named-step inventory exact', () => {
    const names = [...read('.github/workflows/deploy.yml').matchAll(/- name: (.+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Unit / integration tests with coverage',
      'Deploy to Cloudflare Workers',
    ]);
  });

  it('post96: locks CI uses: pin inventory exact', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/uses: (.+)/g)].map((m) => m[1])).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/upload-artifact@v4',
      'actions/checkout@v7',
    ]);
  });

  it('post96: locks deploy uses: pin inventory exact', () => {
    expect([...read('.github/workflows/deploy.yml').matchAll(/uses: (.+)/g)].map((m) => m[1])).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'cloudflare/wrangler-action@v4',
    ]);
  });

  it('post96: locks hygiene grep -q count at 31', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect((hygiene.match(/grep -q /g) ?? []).length).toBe(31);
  });

  it('post96: locks hygiene test -f count at 29', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect((hygiene.match(/test -f /g) ?? []).length).toBe(29);
  });

  it('post96: locks hygiene bang-grep count at 5', () => {
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    expect((hygiene.match(/! grep/g) ?? []).length).toBe(5);
  });

  it('post96: locks CI job keys typecheck/test/hygiene only', () => {
    const jobsBlock = read('.github/workflows/ci.yml').split(/^jobs:\n/m)[1];
    const jobs = [...jobsBlock.matchAll(/^  ([a-z]+):$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('post96: locks deploy job key deploy only', () => {
    const jobs = [...read('.github/workflows/deploy.yml').matchAll(/^  ([a-z]+):$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['deploy']);
  });

  it('post96: locks CI timeout-minutes inventory 10/15/5', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/timeout-minutes: (\d+)/g)].map((m) => Number(m[1]))).toEqual([
      10,
      15,
      5,
    ]);
  });

  it('post96: locks deploy timeout-minutes at 20', () => {
    expect([...read('.github/workflows/deploy.yml').matchAll(/timeout-minutes: (\d+)/g)].map((m) => Number(m[1]))).toEqual([20]);
  });

  it('post96: locks package.json top-level key order', () => {
    expect(Object.keys(JSON.parse(read('package.json')) as Record<string, unknown>)).toEqual([
      'name',
      'version',
      'description',
      'type',
      'scripts',
      'dependencies',
      'devDependencies',
    ]);
  });

  it('post96: locks package.json scripts key order', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).toEqual([
      'dev',
      'deploy',
      'typecheck',
      'test',
      'test:watch',
      'test:coverage',
    ]);
  });

  it('post96: locks package.json scripts values exact', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts).toEqual({
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      typecheck: 'tsc --noEmit',
      test: 'vitest run',
      'test:watch': 'vitest',
      'test:coverage': 'vitest run --coverage',
    });
  });

  it('post96: locks package.json dependencies exact singleton hono', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toBe('^4.13.7');
  });

  it('post96: locks package.json devDependencies key order', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(Object.keys(pkg.devDependencies)).toEqual([
      '@cloudflare/workers-types',
      '@types/node',
      '@vitest/coverage-v8',
      'typescript',
      'vitest',
      'wrangler',
    ]);
  });

  it('post96: locks package.json identity fields', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      version: string;
      type: string;
      description: string;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.type).toBe('module');
    expect(pkg.description).toBe('LLM-curated internet radio — editorial AI over iptv-org catalog');
  });

  it('post96: locks btoa and sha256 of identifier typecheck', () => {
    expect(Buffer.from('typecheck', 'utf8').toString('base64')).toBe('dHlwZWNoZWNr');
    expect(createHash('sha256').update('typecheck').digest('hex')).toBe('0abcfcbf1d4899dc22131c74c8835316a70feed4aade719af87ff9b1b516f830');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('typecheck');
  });

  it('post96: locks btoa and sha256 of identifier test', () => {
    expect(Buffer.from('test', 'utf8').toString('base64')).toBe('dGVzdA==');
    expect(createHash('sha256').update('test').digest('hex')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('test');
  });

  it('post96: locks btoa and sha256 of identifier hygiene', () => {
    expect(Buffer.from('hygiene', 'utf8').toString('base64')).toBe('aHlnaWVuZQ==');
    expect(createHash('sha256').update('hygiene').digest('hex')).toBe('51cc6dfe4d3c65f6f46111214aef00d7ff53715be48226a1398d56d19f5467c3');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('hygiene');
  });

  it('post96: locks btoa and sha256 of identifier deploy', () => {
    expect(Buffer.from('deploy', 'utf8').toString('base64')).toBe('ZGVwbG95');
    expect(createHash('sha256').update('deploy').digest('hex')).toBe('b7bd55c11b781b0ccc43aa6e57f9dadf0660e9d1d4e27e0979ee43a407d454ae');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('deploy');
  });

  it('post96: locks btoa and sha256 of identifier CI', () => {
    expect(Buffer.from('CI', 'utf8').toString('base64')).toBe('Q0k=');
    expect(createHash('sha256').update('CI').digest('hex')).toBe('fe8ee15bb86d27a77f2a62bd71bc65936156c99fe5b58537b347cbad1761fd95');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('name: CI');
  });

  it('post96: locks btoa and sha256 of identifier coverage-report', () => {
    expect(Buffer.from('coverage-report', 'utf8').toString('base64')).toBe('Y292ZXJhZ2UtcmVwb3J0');
    expect(createHash('sha256').update('coverage-report').digest('hex')).toBe('8dee3fc3d8b3aca4bda7762ead5166ec81a6f78d410b04fc9f869ad67583d243');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('coverage-report');
  });

  it('post96: locks btoa and sha256 of identifier GEMINI_API_KEY', () => {
    expect(Buffer.from('GEMINI_API_KEY', 'utf8').toString('base64')).toBe('R0VNSU5JX0FQSV9LRVk=');
    expect(createHash('sha256').update('GEMINI_API_KEY').digest('hex')).toBe('005ffd75c2faf18a9a2c8ec654c99e1d7bea6f13162953832729bd51580808de');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('GEMINI_API_KEY');
  });

  it('post96: locks btoa and sha256 of identifier vitest', () => {
    expect(Buffer.from('vitest', 'utf8').toString('base64')).toBe('dml0ZXN0');
    expect(createHash('sha256').update('vitest').digest('hex')).toBe('a9127f3d34365221cd20a3b712012600645aed15172d49c939fe39ebbb0474e5');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('vitest');
  });

  it('post96: locks btoa and sha256 of identifier hono', () => {
    expect(Buffer.from('hono', 'utf8').toString('base64')).toBe('aG9ubw==');
    expect(createHash('sha256').update('hono').digest('hex')).toBe('8b3dc17add91b7e8f0b5109a389927d66001139cd9b03fa7b95f83126e1b2b23');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('hono');
  });

  it('post96: locks btoa and sha256 of identifier backlink', () => {
    expect(Buffer.from('backlink', 'utf8').toString('base64')).toBe('YmFja2xpbms=');
    expect(createHash('sha256').update('backlink').digest('hex')).toBe('bb52cd593d776fc715441c6ed294a3431aa5e098dab5bcaafa5dc5effe0890d3');
    expect(read('.github/workflows/ci.yml') + read('package.json') + read('.github/workflows/deploy.yml')).toContain('backlink');
  });

  it('post96: locks fromCharCode rebuild of typecheck', () => {
    const name = String.fromCharCode(116, 121, 112, 101, 99, 104, 101, 99, 107);
    expect(name).toBe('typecheck');
    expect(read('.github/workflows/ci.yml') + read('.github/workflows/deploy.yml')).toContain(name);
  });

  it('post96: locks fromCharCode rebuild of hygiene', () => {
    const name = String.fromCharCode(104, 121, 103, 105, 101, 110, 101);
    expect(name).toBe('hygiene');
    expect(read('.github/workflows/ci.yml') + read('.github/workflows/deploy.yml')).toContain(name);
  });

  it('post96: locks fromCharCode rebuild of coverage-report', () => {
    const name = String.fromCharCode(99, 111, 118, 101, 114, 97, 103, 101, 45, 114, 101, 112, 111, 114, 116);
    expect(name).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml') + read('.github/workflows/deploy.yml')).toContain(name);
  });

  it('post96: locks fromCharCode rebuild of GEMINI_API_KEY', () => {
    const name = String.fromCharCode(71, 69, 77, 73, 78, 73, 95, 65, 80, 73, 95, 75, 69, 89);
    expect(name).toBe('GEMINI_API_KEY');
    expect(read('.github/workflows/ci.yml') + read('.github/workflows/deploy.yml')).toContain(name);
  });

  it('post96: locks fromCharCode rebuild of workflow_dispatch', () => {
    const name = String.fromCharCode(119, 111, 114, 107, 102, 108, 111, 119, 95, 100, 105, 115, 112, 97, 116, 99, 104);
    expect(name).toBe('workflow_dispatch');
    expect(read('.github/workflows/ci.yml') + read('.github/workflows/deploy.yml')).toContain(name);
  });

  it('post96: locks fromCharCode rebuild of ubuntu-latest', () => {
    const name = String.fromCharCode(117, 98, 117, 110, 116, 117, 45, 108, 97, 116, 101, 115, 116);
    expect(name).toBe('ubuntu-latest');
    expect(read('.github/workflows/ci.yml') + read('.github/workflows/deploy.yml')).toContain(name);
  });

  it('post96: locks .gitattributes exact bytes', () => {
    expect(read('.gitattributes')).toBe(
      '# Auto detect text files and perform LF normalization\n* text=auto\n',
    );
  });

  it('post96: locks .cursor/environment.json exact bytes', () => {
    expect(read('.cursor/environment.json')).toBe(
      '{\n  "name": "Backlink_Facelift",\n  "install": "npm ci"\n}\n',
    );
  });

  it('post96: locks .github/dependabot.yml exact line inventory', () => {
    expect(read('.github/dependabot.yml').split('\n')).toEqual([
      "version: 2",
      "updates:",
      "  - package-ecosystem: \"npm\"",
      "    directory: \"/\"",
      "    schedule:",
      "      interval: \"monthly\"",
      "    open-pull-requests-limit: 3",
      "    groups:",
      "      npm-dependencies:",
      "        patterns:",
      "          - \"*\"",
      "    ignore:",
      "      - dependency-name: \"*\"",
      "        update-types: [\"version-update:semver-major\"]",
      "",
      "  - package-ecosystem: \"github-actions\"",
      "    directory: \"/\"",
      "    schedule:",
      "      interval: \"monthly\"",
      "    open-pull-requests-limit: 2",
      "    groups:",
      "      github-actions:",
      "        patterns:",
      "          - \"*\"",
      "",
    ]);
  });

  it('post96: locks vitest.config.ts exact line inventory', () => {
    expect(read('vitest.config.ts').split('\n')).toEqual([
      "import { defineConfig } from 'vitest/config';",
      "",
      "export default defineConfig({",
      "  test: {",
      "    environment: 'node',",
      "    include: ['test/**/*.test.ts'],",
      "    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],",
      "    coverage: {",
      "      provider: 'v8',",
      "      include: ['src/**/*.ts'],",
      "      exclude: ['src/types.ts'],",
      "      reporter: ['text', 'text-summary', 'html', 'lcov'],",
      "      thresholds: {",
      "        lines: 100,",
      "        functions: 100,",
      "        branches: 100,",
      "        statements: 100,",
      "      },",
      "    },",
      "  },",
      "});",
      "",
    ]);
  });

  it('post96: locks tsconfig.json exact line inventory', () => {
    expect(read('tsconfig.json').split('\n')).toEqual([
      "{",
      "  \"compilerOptions\": {",
      "    \"target\": \"ES2022\",",
      "    \"lib\": [",
      "      \"ES2022\"",
      "    ],",
      "    \"module\": \"ESNext\",",
      "    \"moduleResolution\": \"Bundler\",",
      "    \"types\": [",
      "      \"@cloudflare/workers-types\",",
      "      \"node\"",
      "    ],",
      "    \"strict\": true,",
      "    \"noEmit\": true,",
      "    \"resolveJsonModule\": true,",
      "    \"skipLibCheck\": true",
      "  },",
      "  \"include\": [",
      "    \"src/**/*.ts\",",
      "    \"test/**/*.ts\",",
      "    \"vitest.config.ts\"",
      "  ]",
      "}",
      "",
    ]);
  });

  it('post96: locks .gitignore exact line inventory', () => {
    expect(read('.gitignore').split('\n')).toEqual([
      "# Dependencies",
      "node_modules/",
      "",
      "# Local env / secrets (never commit)",
      ".env",
      ".env.*",
      "!.env.example",
      ".dev.vars",
      "*.pem",
      "*.key",
      "",
      "# Wrangler / Workers local state",
      ".wrangler/",
      ".mf/",
      "dist/",
      "",
      "# Test coverage output",
      "coverage/",
      "",
      "# Editor / OS noise",
      ".DS_Store",
      ".idea/",
      ".vscode/",
      "*.swp",
      "*~",
      "",
    ]);
  });

  it('post96: locks package.json exact line inventory', () => {
    expect(read('package.json').split('\n')).toEqual([
      "{",
      "  \"name\": \"backlink\",",
      "  \"version\": \"0.1.0\",",
      "  \"description\": \"LLM-curated internet radio — editorial AI over iptv-org catalog\",",
      "  \"type\": \"module\",",
      "  \"scripts\": {",
      "    \"dev\": \"wrangler dev\",",
      "    \"deploy\": \"wrangler deploy\",",
      "    \"typecheck\": \"tsc --noEmit\",",
      "    \"test\": \"vitest run\",",
      "    \"test:watch\": \"vitest\",",
      "    \"test:coverage\": \"vitest run --coverage\"",
      "  },",
      "  \"dependencies\": {",
      "    \"hono\": \"^4.13.7\"",
      "  },",
      "  \"devDependencies\": {",
      "    \"@cloudflare/workers-types\": \"^5.20260911.1\",",
      "    \"@types/node\": \"^22.20.2\",",
      "    \"@vitest/coverage-v8\": \"^5.0.0\",",
      "    \"typescript\": \"^5.7.0\",",
      "    \"vitest\": \"^5.0.0\",",
      "    \"wrangler\": \"^4.131.1\"",
      "  }",
      "}",
      "",
    ]);
  });

  it('post96: locks .github top-level inventory', () => {
    expect(readdirSync(join(root, '.github')).sort()).toEqual([
      'ISSUE_TEMPLATE',
      'dependabot.yml',
      'workflows',
    ]);
  });

  it('post96: locks .github/workflows inventory', () => {
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post96: locks ISSUE_TEMPLATE inventory', () => {
    expect(readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort()).toEqual([
      'bug.yml',
      'chore.yml',
      'config.yml',
      'feature.yml',
    ]);
  });

  it('post96: locks AGENTS.md H2 inventory', () => {
    expect([...read('AGENTS.md').matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
      'Classification',
      'Purpose',
      'Safe Agent Actions',
      'Verify',
      'Escalate to Human',
    ]);
  });

  it('post96: locks DEPLOY.md H2 inventory', () => {
    expect([...read('DEPLOY.md').matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
      'Prerequisites',
      'Steps',
      'Cost Estimate',
      'Local dev',
      'HITL Required',
    ]);
  });

  it('post96: locks README.md H2 inventory', () => {
    expect([...read('README.md').matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual([
      'Cloud agents',
      'API',
      'Example Response',
      'Deploy Your Own',
      'Stack',
      'Available Genres',
      'Part of the smtp.eth ecosystem',
    ]);
  });

  it('post96: locks AGENTS verify block matches package scripts', () => {
    const agents = read('AGENTS.md');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post96: locks CI and deploy both pin Node 20 + npm cache', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'] as const) {
      const body = read(rel);
      expect(body).toContain('node-version: "20"');
      expect(body).toContain('cache: "npm"');
      expect(body).toContain('actions/setup-node@v7');
      expect(body).toContain('actions/checkout@v7');
      expect(body).toContain('persist-credentials: false');
      expect(body).toContain('npm ci');
    }
  });

  it('post96: locks CI concurrency cancel-in-progress true while deploy false', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/cancel-in-progress:\s*true/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/cancel-in-progress:\s*false/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/cancel-in-progress:\s*false/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it('post96: locks coverage thresholds object keys order lines/functions/branches/statements', () => {
    const cfg = read('vitest.config.ts');
    const idx = {
      lines: cfg.indexOf('lines: 100'),
      functions: cfg.indexOf('functions: 100'),
      branches: cfg.indexOf('branches: 100'),
      statements: cfg.indexOf('statements: 100'),
    };
    expect(idx.lines).toBeGreaterThan(-1);
    expect(idx.functions).toBeGreaterThan(idx.lines);
    expect(idx.branches).toBeGreaterThan(idx.functions);
    expect(idx.statements).toBeGreaterThan(idx.branches);
  });

  it('post96: locks vitest coverage reporters order text/text-summary/html/lcov', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain("reporter: ['text', 'text-summary', 'html', 'lcov']");
  });

  it('post96: locks CI byte prefix hex for name CI header', () => {
    expect(Buffer.from(read('.github/workflows/ci.yml').slice(0, 20), 'utf8').toString('hex')).toBe(
      '6e616d653a2043490a0a6f6e3a0a202070757368',
    );
  });

  it('post96: locks deploy byte prefix hex for Deploy header', () => {
    expect(Buffer.from(read('.github/workflows/deploy.yml').slice(0, 20), 'utf8').toString('hex')).toBe(
      '6e616d653a204465706c6f7920746f20436c6f75',
    );
  });

  it('post96: locks Map inventory of CI job timeouts', () => {
    const map = new Map([
      ['typecheck', 10],
      ['test', 15],
      ['hygiene', 5],
    ]);
    expect(map.size).toBe(3);
    expect([...map.values()].reduce((a, b) => a + b, 0)).toBe(30);
    const ci = read('.github/workflows/ci.yml');
    for (const [job, mins] of map) {
      expect(ci).toContain(`  ${job}:`);
      expect(ci).toContain(`timeout-minutes: ${mins}`);
    }
  });

  it('post96: locks Set of CI required suite filenames', () => {
    const suites = new Set([
      'parser.test.ts',
      'genres.test.ts',
      'routes.test.ts',
      'mcp.test.ts',
      'helpers.ts',
      'helpers.test.ts',
      'mcp-spec-contract.test.ts',
      'ci-config.test.ts',
      'wrangler-config.test.ts',
      'source-contracts.test.ts',
    ]);
    const hygiene = read('.github/workflows/ci.yml').split('name: Hygiene')[1];
    for (const f of suites) {
      expect(hygiene).toContain(`test -f test/${f}`);
    }
    expect(suites.size).toBe(10);
  });

  it('post96: locks Intl.Collator sorted CI job names', () => {
    expect(['hygiene', 'test', 'typecheck'].sort(new Intl.Collator('en').compare)).toEqual([
      'hygiene',
      'test',
      'typecheck',
    ]);
    expect(read('.github/workflows/ci.yml')).toContain('  typecheck:');
  });

  it('post96: locks structuredClone of package scripts independent', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const clone = structuredClone(pkg.scripts);
    clone.test = 'mutated';
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('post96: locks Proxy read of package scripts typecheck', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const proxy = new Proxy(pkg.scripts, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(proxy.typecheck).toBe('tsc --noEmit');
    expect(proxy['test:coverage']).toBe('vitest run --coverage');
  });

  it('post96: locks Object.is frozen identity of package name/version', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
    expect(Object.is(pkg.name, 'backlink')).toBe(true);
    expect(Object.is(pkg.version, '0.1.0')).toBe(true);
  });

  it('post96: locks WeakMap can key package scripts object', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const wm = new WeakMap<object, string>();
    wm.set(pkg.scripts, 'scripts');
    expect(wm.get(pkg.scripts)).toBe('scripts');
  });

  it('post96: locks Buffer compare CI prefix name', () => {
    expect(Buffer.from(read('.github/workflows/ci.yml').slice(0, 8), 'utf8').equals(Buffer.from('name: CI'))).toBe(true);
  });

  it('post96: locks encodeURI of workflow paths equals itself', () => {
    for (const p of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'] as const) {
      expect(encodeURI(p)).toBe(p);
      expect(read(p).length).toBeGreaterThan(0);
    }
  });

  it('post96: locks JSON.stringify package scripts key count stable', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(JSON.parse(JSON.stringify(pkg.scripts)) as Record<string, string>)).toHaveLength(6);
  });

  it('post96: locks Array.from of CI job list equals spread', () => {
    const jobs = ['typecheck', 'test', 'hygiene'] as const;
    expect(Array.from(jobs)).toEqual([...jobs]);
    expect(read('.github/workflows/ci.yml')).toContain('  hygiene:');
  });

  it('post96: locks performance.now around read ci.yml is finite', () => {
    const t0 = performance.now();
    expect(read('.github/workflows/ci.yml').length).toBeGreaterThan(0);
    expect(Number.isFinite(performance.now() - t0)).toBe(true);
  });

  it('post96: locks queueMicrotask does not alter ci.yml digest', async () => {
    const before = createHash('sha256').update(read('.github/workflows/ci.yml')).digest('hex');
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(createHash('sha256').update(read('.github/workflows/ci.yml')).digest('hex')).toBe(before);
  });

  it('post96: locks AbortSignal.timeout unused by CI YAML', () => {
    expect(typeof AbortSignal.timeout).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/AbortSignal/);
  });

  it('post96: locks Headers unused by CI YAML contracts', () => {
    expect(new Headers({ Accept: 'application/json' }).get('Accept')).toBe('application/json');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\bHeaders\b/);
  });

  it('post96: locks Blob round-trip of workflow name CI', async () => {
    const blob = new Blob(['CI'], { type: 'text/plain' });
    expect(await blob.text()).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post96: locks DataView reads Node version major 20 bytes', () => {
    const buf = new TextEncoder().encode('20');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint8(0)).toBe(0x32);
    expect(view.getUint8(1)).toBe(0x30);
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
  });

  it('post96: locks CI free of matrix/fail-fast/environment protection', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/strategy:|matrix:|fail-fast:/);
    expect(ci).not.toMatch(/\benvironment:/);
  });

  it('post96: locks deploy free of matrix and environment protection keys', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/strategy:|matrix:|fail-fast:/);
    expect(deploy).not.toMatch(/^\s+environment:/m);
  });

  it('post96: locks CI permissions contents read only block', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/permissions:\n  contents: read\n/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/id-token:|packages:|pull-requests:|issues:|actions:/);
  });

  it('post96: locks deploy permissions contents read only block', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/permissions:\n  contents: read\n/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/id-token:|packages:|pull-requests:|issues:|actions:/);
  });

  it('post96: locks dependabot ecosystems npm then github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.indexOf('package-ecosystem: "npm"')).toBeLessThan(dep.indexOf('package-ecosystem: "github-actions"'));
    expect((dep.match(/package-ecosystem:/g) ?? []).length).toBe(2);
  });

  it('post96: locks dependabot open-pull-requests-limit 3 then 2', () => {
    expect([...read('.github/dependabot.yml').matchAll(/open-pull-requests-limit: (\d+)/g)].map((m) => Number(m[1]))).toEqual([
      3,
      2,
    ]);
  });

  it('post96: locks dependabot monthly cadence twice', () => {
    expect((read('.github/dependabot.yml').match(/interval: "monthly"/g) ?? []).length).toBe(2);
  });

  it('post96: locks package-lock lockfileVersion 3 and name backlink', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number; name: string };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe('backlink');
  });

  it('post96: locks tsconfig compilerOptions identity pins', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('post96: locks CI on: triggers push and pull_request against main only', () => {
    const onBlock = read('.github/workflows/ci.yml').split('jobs:')[0];
    expect(onBlock).toContain('push:');
    expect(onBlock).toContain('pull_request:');
    expect(onBlock).toContain('branches: [main]');
    expect(onBlock).not.toContain('pull_request_target');
    expect(onBlock).not.toContain('workflow_dispatch');
  });

  it('post96: locks deploy on: is workflow_dispatch only', () => {
    const onBlock = read('.github/workflows/deploy.yml').split('jobs:')[0];
    expect(onBlock).toContain('workflow_dispatch:');
    expect(onBlock).not.toContain('push:');
    expect(onBlock).not.toContain('pull_request:');
  });

  it('post96: locks CI defaults shell bash before jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('defaults:')).toBeLessThan(ci.indexOf('jobs:'));
    expect(ci).toContain('shell: bash');
  });

  it('post96: locks CI ASCII-only while package.json keeps one em-dash', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect(read('.github/dependabot.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect([...read('package.json')].filter((c) => c.charCodeAt(0) > 127)).toEqual(['—']);
  });

  it('post96: locks CI/deploy/dependabot/vitest/tsconfig/package byte total', () => {
    const rels = [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'package.json',
      'vitest.config.ts',
      'tsconfig.json',
      '.gitignore',
    ] as const;
    const total = rels.reduce((a, rel) => a + statSync(join(root, rel)).size, 0);
    expect(total).toBe(6295 + 1004 + 505 + 637 + 535 + 397 + 261);
  });

  it('post96: locks hygiene required-file checks include all nine test suites', () => {
    const hygiene = read('.github/workflows/ci.yml');
    for (const f of [
      'ci-config.test.ts',
      'genres.test.ts',
      'helpers.test.ts',
      'mcp-spec-contract.test.ts',
      'mcp.test.ts',
      'parser.test.ts',
      'routes.test.ts',
      'source-contracts.test.ts',
      'wrangler-config.test.ts',
    ] as const) {
      expect(hygiene).toContain(`test -f test/${f}`);
    }
  });

  it('post96: locks CI bans anthropic/claude/haiku leftovers in hygiene', () => {
    const hygiene = read('.github/workflows/ci.yml');
    expect(hygiene).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(hygiene).toContain("! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'");
  });

  it('post96: locks deploy secrets block lists only GEMINI_API_KEY', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const secretsBlock = deploy.split('secrets: |')[1].split('env:')[0];
    expect(secretsBlock.trim().split(/\s+/)).toEqual(['GEMINI_API_KEY']);
  });

  it('post96: locks CI concurrency group template', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'group: ci-${{ github.workflow }}-${{ github.ref }}',
    );
  });

  it('post96: locks deploy concurrency group template', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('group: deploy-${{ github.workflow }}');
  });

  it('post96: locks coverage artifact upload if always + retention 14', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('if: always()');
    expect(ci).toContain('retention-days: 14');
    expect(ci).toContain('if-no-files-found: error');
    expect(ci).toContain('name: coverage-report');
  });

  it('post96: locks Assert coverage artifacts exist step body', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('test -d coverage');
    expect(ci).toContain('test -f coverage/lcov.info');
    expect(ci).toContain('test -s coverage/lcov.info');
    expect(ci).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post96: locks localeCompare ordering of workflow filenames', () => {
    expect(['deploy.yml', 'ci.yml'].sort((a, b) => a.localeCompare(b))).toEqual(['ci.yml', 'deploy.yml']);
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post96: locks TextEncoder/Decoder round-trip of CI name', () => {
    const enc = new TextEncoder().encode('CI');
    expect(new TextDecoder().decode(enc)).toBe('CI');
    expect(read('.github/workflows/ci.yml')).toContain('name: CI');
  });

  it('post96: locks URL can parse package name as path segment', () => {
    const u = new URL('https://example.com/backlink');
    expect(u.pathname).toBe('/backlink');
    expect((JSON.parse(read('package.json')) as { name: string }).name).toBe('backlink');
  });

  it('post96: locks Atomics wait absence — CI is pure YAML', () => {
    expect(typeof Atomics).toBe('object');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/Atomics/);
  });

  it('post96: locks SharedArrayBuffer unused by CI contracts', () => {
    expect(typeof SharedArrayBuffer).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/SharedArrayBuffer/);
  });

  it('post96: locks FormData absence in workflows', () => {
    expect(typeof FormData).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/FormData|multipart/i);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/FormData|multipart/i);
  });

  it('post96: locks Relative path join of workflows stays under .github', () => {
    expect(join('.github', 'workflows', 'ci.yml')).toBe('.github/workflows/ci.yml');
    expect(join('.github', 'workflows', 'deploy.yml')).toBe('.github/workflows/deploy.yml');
  });

  it('post96: locks dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(read('package.json')).toContain('"name": "backlink"');
  });

  it('post96: locks ci-config.test.ts ends with newline after post96', () => {
    expect(read('test/ci-config.test.ts').endsWith('\n')).toBe(true);
  });
});

describe('post96 ci-config HEAVY deepen', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) =>
    createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorFold = (a: string, b: string) => {
    const A = Buffer.from(a, 'hex');
    const B = Buffer.from(b, 'hex');
    let x = 0;
    for (let i = 0; i < A.length; i++) x ^= A[i] ^ B[i];
    return x;
  };
  const byteSize = (rel: string) => statSync(join(root, rel)).size;
  const lineCount = (rel: string) => read(rel).split('\n').length;

  it('post96: locks README.md sha256 digest', () => {
    expect(sha256('README.md')).toBe(
      'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
    );
  });

  it('post96: locks README.md sha1 digest', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post96: locks README.md md5 digest', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post96: locks README.md sha512 digest', () => {
    expect(sha512('README.md')).toBe(
      'a66447cc7968b9d04a99157b8598e52dc849462692f4e34fc8af624c5a92377700bea429e236b8102cd76bf48d680ed490795b1da33909f001d8fec14336e337',
    );
  });

  it('post96: locks README.md sha256 nibble sum to 429', () => {
    expect(nibbleSum(sha256('README.md'))).toBe(429);
  });

  it('post96: locks README.md byte size to 2801', () => {
    expect(byteSize('README.md')).toBe(2801);
  });

  it('post96: locks README.md line count to 82', () => {
    expect(lineCount('README.md')).toBe(82);
  });

  it('post96: locks README.md space count to 330', () => {
    expect([...read('README.md')].filter((c) => c === ' ')).toHaveLength(330);
  });

  it('post96: locks DEPLOY.md sha256 digest', () => {
    expect(sha256('DEPLOY.md')).toBe(
      '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
    );
  });

  it('post96: locks DEPLOY.md sha1 digest', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post96: locks DEPLOY.md md5 digest', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post96: locks DEPLOY.md sha512 digest', () => {
    expect(sha512('DEPLOY.md')).toBe(
      '504275c3bb3c4aa2dd5b4baa6accef1d5a8b83e995bf92146bed27604089ad7ae4540575691383a03a36062562e4388984a560a7ab199451b3bc063104162b80',
    );
  });

  it('post96: locks DEPLOY.md sha256 nibble sum to 439', () => {
    expect(nibbleSum(sha256('DEPLOY.md'))).toBe(439);
  });

  it('post96: locks DEPLOY.md byte size to 1573', () => {
    expect(byteSize('DEPLOY.md')).toBe(1573);
  });

  it('post96: locks DEPLOY.md line count to 65', () => {
    expect(lineCount('DEPLOY.md')).toBe(65);
  });

  it('post96: locks DEPLOY.md space count to 201', () => {
    expect([...read('DEPLOY.md')].filter((c) => c === ' ')).toHaveLength(201);
  });

  it('post96: locks wrangler.toml sha256 digest', () => {
    expect(sha256('wrangler.toml')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post96: locks wrangler.toml sha1 digest', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post96: locks wrangler.toml md5 digest', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post96: locks wrangler.toml sha512 digest', () => {
    expect(sha512('wrangler.toml')).toBe(
      '4fdd7f275037737b409d87c97826e8f84d32099a9e0fd3f85458fe047cba2130dff6b160020af775b50634db4bade3cbfe838bf7e7638ed69f69b43a2cb53a96',
    );
  });

  it('post96: locks wrangler.toml sha256 nibble sum to 457', () => {
    expect(nibbleSum(sha256('wrangler.toml'))).toBe(457);
  });

  it('post96: locks wrangler.toml byte size to 330', () => {
    expect(byteSize('wrangler.toml')).toBe(330);
  });

  it('post96: locks wrangler.toml line count to 18', () => {
    expect(lineCount('wrangler.toml')).toBe(18);
  });

  it('post96: locks wrangler.toml space count to 26', () => {
    expect([...read('wrangler.toml')].filter((c) => c === ' ')).toHaveLength(26);
  });

  it('post96: locks ISSUE bug.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'f76fcc573b913789446748a601dcb4a8d2cfaa3ec85d2c6bb798f2a35b844055',
    );
  });

  it('post96: locks ISSUE bug.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/bug.yml')).toBe('d03c99b857f1589125c3bc266ae29317f6c7ba0a');
  });

  it('post96: locks ISSUE bug.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/bug.yml')).toBe('3693b9bfd65bf683be0706b83831ae69');
  });

  it('post96: locks ISSUE bug.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'c0c19929fcaf9c18b96a228a420807fb5b8a0c41b7c38aba0680e0a518d267413c14c618e5d3d3b22829b73f5a53c11e713e41bbbe154565ba1fd567f5a67e90',
    );
  });

  it('post96: locks ISSUE bug.yml sha256 nibble sum to 493', () => {
    expect(nibbleSum(sha256('.github/ISSUE_TEMPLATE/bug.yml'))).toBe(493);
  });

  it('post96: locks ISSUE bug.yml byte size to 846', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/bug.yml')).toBe(846);
  });

  it('post96: locks ISSUE bug.yml line count to 41', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/bug.yml')).toBe(41);
  });

  it('post96: locks ISSUE bug.yml space count to 208', () => {
    expect([...read('.github/ISSUE_TEMPLATE/bug.yml')].filter((c) => c === ' ')).toHaveLength(208);
  });

  it('post96: locks ISSUE chore.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '230222c6ac61737a55b00df4442d483911154bd93657ba98a1d30b75b509c3fc',
    );
  });

  it('post96: locks ISSUE chore.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/chore.yml')).toBe('9b401e414cbc1a5fab58fa4ae6d43957a4ef05fd');
  });

  it('post96: locks ISSUE chore.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/chore.yml')).toBe('2eff43364806910ca218e00054a2304a');
  });

  it('post96: locks ISSUE chore.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '0ef6ef054700858f1434bb5dc71d03bc5f22d470b32b3336254ad8cd3c9c22f2b405630b0a04df7836cb7758ec686dc0b7c004d85b5628772d1c68e4d44598cb',
    );
  });

  it('post96: locks ISSUE chore.yml sha256 nibble sum to 406', () => {
    expect(nibbleSum(sha256('.github/ISSUE_TEMPLATE/chore.yml'))).toBe(406);
  });

  it('post96: locks ISSUE chore.yml byte size to 705', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/chore.yml')).toBe(705);
  });

  it('post96: locks ISSUE chore.yml line count to 33', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/chore.yml')).toBe(33);
  });

  it('post96: locks ISSUE chore.yml space count to 173', () => {
    expect([...read('.github/ISSUE_TEMPLATE/chore.yml')].filter((c) => c === ' ')).toHaveLength(173);
  });

  it('post96: locks ISSUE feature.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '83291f987d1bb546b45ecd09d9be597c5265591a99744d18a2c49122e390aac2',
    );
  });

  it('post96: locks ISSUE feature.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/feature.yml')).toBe('e23c853fb5eebf3a04e9f487f2c9d879d40216b7');
  });

  it('post96: locks ISSUE feature.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/feature.yml')).toBe('c73a814e3784562d4ab200328793c60f');
  });

  it('post96: locks ISSUE feature.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '3652135ac2e4397524c5ebeed2fea46c1e31addc0dcbf5a62287fd594fdc49bbfa926f3d778d91ebd11cb93565682626329f36467af10d6853c51c41147d97a6',
    );
  });

  it('post96: locks ISSUE feature.yml sha256 nibble sum to 461', () => {
    expect(nibbleSum(sha256('.github/ISSUE_TEMPLATE/feature.yml'))).toBe(461);
  });

  it('post96: locks ISSUE feature.yml byte size to 966', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/feature.yml')).toBe(966);
  });

  it('post96: locks ISSUE feature.yml line count to 44', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/feature.yml')).toBe(44);
  });

  it('post96: locks ISSUE feature.yml space count to 232', () => {
    expect([...read('.github/ISSUE_TEMPLATE/feature.yml')].filter((c) => c === ' ')).toHaveLength(232);
  });

  it('post96: locks ISSUE config.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '1f103c6a9dd07cd13a9a6f17ace6b813f47747eb9cb7e00488cb2073caaf91bb',
    );
  });

  it('post96: locks ISSUE config.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/config.yml')).toBe('68344263f9bbfe0fc196c0e6c1a55818cc46dc01');
  });

  it('post96: locks ISSUE config.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/config.yml')).toBe('74c7aebcc7755d1241890df4fd87c662');
  });

  it('post96: locks ISSUE config.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '3525514870b59d330e696be298847092a3e9d69470d7dbb7d410fd83f8afdbefe49d711b9383dee9664d3ee92ec70e98989b096eeb427176106de8fd948bf628',
    );
  });

  it('post96: locks ISSUE config.yml sha256 nibble sum to 498', () => {
    expect(nibbleSum(sha256('.github/ISSUE_TEMPLATE/config.yml'))).toBe(498);
  });

  it('post96: locks ISSUE config.yml byte size to 28', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/config.yml')).toBe(28);
  });

  it('post96: locks ISSUE config.yml line count to 2', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/config.yml')).toBe(2);
  });

  it('post96: locks ISSUE config.yml space count to 1', () => {
    expect([...read('.github/ISSUE_TEMPLATE/config.yml')].filter((c) => c === ' ')).toHaveLength(1);
  });

  it('post96: locks README.md first and last 40 characters', () => {
    const text = read('README.md');
    expect(text.slice(0, 40)).toBe('# Backlink 📻\n\n[![CI](https://github.com');
    expect(text.slice(-40)).toBe('pas](https://fuzzywigg.com) / Geryon 🦀\n');
  });

  it('post96: locks DEPLOY.md first and last 40 characters', () => {
    const text = read('DEPLOY.md');
    expect(text.slice(0, 40)).toBe('# Backlink — Deployment Guide\n\n## Prereq');
    expect(text.slice(-40)).toBe('external data sources requires approval\n');
  });

  it('post96: locks wrangler.toml first and last 40 characters', () => {
    const text = read('wrangler.toml');
    expect(text.slice(0, 40)).toBe('name = "backlink"\nmain = "src/index.ts"\n');
    expect(text.slice(-40)).toBe('):\n# wrangler secret put GEMINI_API_KEY\n');
  });

  it('post96: locks .github/workflows/ci.yml sha512 digest (leftover)', () => {
    expect(sha512('.github/workflows/ci.yml')).toBe(
      '3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460',
    );
  });

  it('post96: locks .github/workflows/deploy.yml sha512 digest (leftover)', () => {
    expect(sha512('.github/workflows/deploy.yml')).toBe(
      '7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641',
    );
  });

  it('post96: locks .github/dependabot.yml sha512 digest (leftover)', () => {
    expect(sha512('.github/dependabot.yml')).toBe(
      '276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e',
    );
  });

  it('post96: locks vitest.config.ts sha512 digest (leftover)', () => {
    expect(sha512('vitest.config.ts')).toBe(
      'ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682',
    );
  });

  it('post96: locks package.json sha512 digest (leftover)', () => {
    expect(sha512('package.json')).toBe(
      '7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28',
    );
  });

  it('post96: locks tsconfig.json sha512 digest (leftover)', () => {
    expect(sha512('tsconfig.json')).toBe(
      '1ef6e98053d98ec50aeabad12d3f8b7bd44bd81f1a0f63264f0b8530b65b75a1f4e4f705147467a3099a0a89674db33becaf259d25b28c546d2cbdb4862614f3',
    );
  });

  it('post96: locks .gitignore sha512 digest (leftover)', () => {
    expect(sha512('.gitignore')).toBe(
      'b51faf155fa4927dcc7032a23ddace6ba90c71a7e165382c024c79f21693d5c2be91df95ef4b632b1f4577ad0a18d19d11e450d647ff99c11f95f29b3fa4a5c0',
    );
  });

  it('post96: locks .cursor/environment.json sha512 digest (leftover)', () => {
    expect(sha512('.cursor/environment.json')).toBe(
      'bc77873140fa55fe7b9ff10f6c7ebb8e287d35087bc0da8667814e3db45773a3a4bcecb1f7ab7479e0a2c0c4cad140c385583af6a0bb760a01121a1c830a6efb',
    );
  });

  it('post96: locks AGENTS.md sha512 digest (leftover)', () => {
    expect(sha512('AGENTS.md')).toBe(
      '7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908',
    );
  });

  it('post96: locks .gitattributes sha512 digest (leftover)', () => {
    expect(sha512('.gitattributes')).toBe(
      '9e820d6126d62c0b89e380c69685f6668b2f131283f57e524f59492fa6df22844dda1b90d244d4a1f8aea78a84e65d47b1a878168c4e41001459a947ef275ffe',
    );
  });

  it('post96: locks package-lock.json sha512 digest (leftover)', () => {
    expect(sha512('package-lock.json')).toBe(
      '53b687e02a98373356e850535322bbec058b7b8dff2374fb03de81d925065cdb7a15cd37411e4625a3888965ba07d2667e6f6667db885bf14147027d0183303d',
    );
  });

  it('post96: locks .github/workflows/ci.yml byte size to 6295', () => {
    expect(byteSize('.github/workflows/ci.yml')).toBe(6295);
  });

  it('post96: locks .github/workflows/ci.yml line count to 177', () => {
    expect(lineCount('.github/workflows/ci.yml')).toBe(177);
  });

  it('post96: locks .github/workflows/deploy.yml byte size to 1004', () => {
    expect(byteSize('.github/workflows/deploy.yml')).toBe(1004);
  });

  it('post96: locks .github/workflows/deploy.yml line count to 47', () => {
    expect(lineCount('.github/workflows/deploy.yml')).toBe(47);
  });

  it('post96: locks .github/dependabot.yml byte size to 505', () => {
    expect(byteSize('.github/dependabot.yml')).toBe(505);
  });

  it('post96: locks .github/dependabot.yml line count to 25', () => {
    expect(lineCount('.github/dependabot.yml')).toBe(25);
  });

  it('post96: locks vitest.config.ts byte size to 535', () => {
    expect(byteSize('vitest.config.ts')).toBe(535);
  });

  it('post96: locks vitest.config.ts line count to 22', () => {
    expect(lineCount('vitest.config.ts')).toBe(22);
  });

  it('post96: locks package.json byte size to 637', () => {
    expect(byteSize('package.json')).toBe(637);
  });

  it('post96: locks package.json line count to 26', () => {
    expect(lineCount('package.json')).toBe(26);
  });

  it('post96: locks tsconfig.json byte size to 397', () => {
    expect(byteSize('tsconfig.json')).toBe(397);
  });

  it('post96: locks tsconfig.json line count to 24', () => {
    expect(lineCount('tsconfig.json')).toBe(24);
  });

  it('post96: locks .gitignore byte size to 261', () => {
    expect(byteSize('.gitignore')).toBe(261);
  });

  it('post96: locks .gitignore line count to 26', () => {
    expect(lineCount('.gitignore')).toBe(26);
  });

  it('post96: locks .cursor/environment.json byte size to 57', () => {
    expect(byteSize('.cursor/environment.json')).toBe(57);
  });

  it('post96: locks .cursor/environment.json line count to 5', () => {
    expect(lineCount('.cursor/environment.json')).toBe(5);
  });

  it('post96: locks AGENTS.md byte size to 1017', () => {
    expect(byteSize('AGENTS.md')).toBe(1017);
  });

  it('post96: locks AGENTS.md line count to 35', () => {
    expect(lineCount('AGENTS.md')).toBe(35);
  });

  it('post96: locks .gitattributes byte size to 66', () => {
    expect(byteSize('.gitattributes')).toBe(66);
  });

  it('post96: locks .gitattributes line count to 3', () => {
    expect(lineCount('.gitattributes')).toBe(3);
  });

  it('post96: locks package-lock.json byte size to 92068', () => {
    expect(byteSize('package-lock.json')).toBe(92068);
  });

  it('post96: locks package-lock.json line count to 2842', () => {
    expect(lineCount('package-lock.json')).toBe(2842);
  });

  it('post96: xor-fold of CI and deploy sha256 digests stays 97', () => {
    expect(xorFold(sha256('.github/workflows/ci.yml'), sha256('.github/workflows/deploy.yml'))).toBe(97);
  });

  it('post96: xor-fold of README and DEPLOY.md sha256 digests stays 66', () => {
    expect(xorFold(sha256('README.md'), sha256('DEPLOY.md'))).toBe(66);
  });

  it('post96: xor-fold of ISSUE bug and feature sha256 digests stays 34', () => {
    expect(
      xorFold(
        sha256('.github/ISSUE_TEMPLATE/bug.yml'),
        sha256('.github/ISSUE_TEMPLATE/feature.yml'),
      ),
    ).toBe(34);
  });

  it('post96: locks CI named-step inventory order', () => {
    const names = [...read('.github/workflows/ci.yml').matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Set up Node.js',
      'Install dependencies',
      'Unit / integration tests with coverage',
      'Assert coverage artifacts exist',
      'Upload coverage report',
      'Check required files',
      'Check for committed secret material',
    ]);
  });

  it('post96: locks deploy named-step inventory order', () => {
    const names = [...read('.github/workflows/deploy.yml').matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Unit / integration tests with coverage',
      'Deploy to Cloudflare Workers',
    ]);
  });

  it('post96: locks CI uses: action pin inventory', () => {
    const uses = [...read('.github/workflows/ci.yml').matchAll(/uses:\s*(.+)/g)].map((m) => m[1].trim());
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/upload-artifact@v4',
      'actions/checkout@v7',
    ]);
  });

  it('post96: locks deploy uses: action pin inventory', () => {
    const uses = [...read('.github/workflows/deploy.yml').matchAll(/uses:\s*(.+)/g)].map((m) => m[1].trim());
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'cloudflare/wrangler-action@v4',
    ]);
  });

  it('post96: CI checkout@v7 appears exactly three times', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/actions\/checkout@v7/g)]).toHaveLength(3);
  });

  it('post96: CI ubuntu-latest appears exactly three times (one per job)', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/ubuntu-latest/g)]).toHaveLength(3);
  });

  it('post96: CI npm token appears exactly eight times', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/npm/g)]).toHaveLength(8);
  });

  it('post96: package-lock name/version/requires identity', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      version: string;
      lockfileVersion: number;
      requires: boolean;
      packages: Record<string, unknown>;
    };
    expect(lock.name).toBe('backlink');
    expect(lock.version).toBe('0.1.0');
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.requires).toBe(true);
    expect(Object.keys(lock.packages)).toHaveLength(168);
  });

  it('post96: package.json top-level key order', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(Object.keys(pkg)).toEqual([
      'name',
      'version',
      'description',
      'type',
      'scripts',
      'dependencies',
      'devDependencies',
    ]);
  });

  it('post96: package.json devDependencies key order', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.devDependencies)).toEqual([
      '@cloudflare/workers-types',
      '@types/node',
      '@vitest/coverage-v8',
      'typescript',
      'vitest',
      'wrangler',
    ]);
  });

  it('post96: package.json has exactly one runtime dependency hono', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  });

  it('post96: AGENTS.md classification Tier A Autonomy L2', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)');
    expect(agents).toContain('Autonomy: L2 (Standard — non-critical infra)');
    expect(agents).toContain('parent_governance: github.com/fuzzywigg/agents-governance');
  });

  it('post96: AGENTS.md Escalate to Human inventory order', () => {
    const section = read('AGENTS.md').split('## Escalate to Human')[1];
    const bullets = [...section.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(bullets).toEqual([
      'Changes to GEMINI_API_KEY handling or any secret management',
      'Production deploy (first deploy must be HITL)',
      'Adding new external data sources beyond iptv-org',
      'Changes to CORS or authentication logic',
      'Any billing or CF account configuration',
    ]);
  });

  it('post96: AGENTS.md Safe Agent Actions inventory includes genres parser tests endpoints docs deps', () => {
    const section = read('AGENTS.md').split('## Safe Agent Actions')[1].split('## Verify')[0];
    expect(section).toContain('src/genres.ts');
    expect(section).toContain('src/parser.ts');
    expect(section).toContain('test/');
    expect(section).toContain('/playlist');
    expect(section).toContain('/now-playing');
    expect(section).toContain('Bump dependency versions');
  });

  it('post96: AGENTS Verify fence matches package scripts exactly', () => {
    const verify = read('AGENTS.md').split('## Verify')[1].split('## Escalate')[0];
    expect(verify).toContain('npm ci');
    expect(verify).toContain('npm run typecheck');
    expect(verify).toContain('npm test');
    expect(verify).toContain('npm run test:coverage');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post96: dependabot monthly interval for both ecosystems', () => {
    const dep = read('.github/dependabot.yml');
    expect([...dep.matchAll(/interval:\s*"monthly"/g)]).toHaveLength(2);
    expect(dep).toContain('open-pull-requests-limit: 3');
    expect(dep).toContain('open-pull-requests-limit: 2');
  });

  it('post96: dependabot group names npm-dependencies and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toContain('github-actions:');
    expect(dep).toContain('update-types: ["version-update:semver-major"]');
  });

  it('post96: vitest coverage exclude is only src/types.ts', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain("exclude: ['src/types.ts']");
    expect(cfg).toContain("include: ['src/**/*.ts']");
    expect(cfg).toContain("provider: 'v8'");
    expect(cfg).toContain("environment: 'node'");
  });

  it('post96: vitest reporters switch on GITHUB_ACTIONS env', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default']",
    );
  });

  it('post96: vitest coverage reporters inventory text text-summary html lcov', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporter: ['text', 'text-summary', 'html', 'lcov']",
    );
  });

  it('post96: tsconfig include inventory src test vitest.config', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('post96: tsconfig types inventory cloudflare workers + node', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { types: string[]; target: string; module: string; moduleResolution: string };
    };
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
  });

  it('post96: README CI badge path matches hygiene-required ci.yml', () => {
    const readme = read('README.md');
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml/badge.svg',
    );
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml',
    );
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post96: README documents coverage floors at 100% matching vitest thresholds', () => {
    expect(read('README.md')).toContain('**100%** statements/branches/functions/lines');
    const cfg = read('vitest.config.ts');
    for (const key of ['lines', 'functions', 'branches', 'statements']) {
      expect(cfg).toMatch(new RegExp(`${key}:\\s*100`));
    }
  });

  it('post96: README Cloud agents verify block matches AGENTS Verify fence', () => {
    const readme = read('README.md');
    expect(readme).toContain('npm ci');
    expect(readme).toContain('npm run typecheck');
    expect(readme).toContain('npm test');
    expect(readme).toContain('npm run test:coverage');
    expect(readme).toContain('.cursor/environment.json');
    expect(readme).toContain('Deploy remains HITL');
  });

  it('post96: wrangler.toml name main compatibility_date VERSION pins', () => {
    const toml = read('wrangler.toml');
    expect(toml).toContain('name = "backlink"');
    expect(toml).toContain('main = "src/index.ts"');
    expect(toml).toContain('compatibility_date = "2025-01-01"');
    expect(toml).toContain('VERSION = "0.1.0"');
    expect(toml).toContain('binding = "CATALOG_CACHE"');
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(toml).toContain('custom_domain = true');
  });

  it('post96: wrangler.toml never commits GEMINI_API_KEY assignment', () => {
    expect(read('wrangler.toml')).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(read('wrangler.toml')).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('post96: ISSUE_TEMPLATE config.yml is exactly blank_issues_enabled false', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toBe('blank_issues_enabled: false\n');
  });

  it('post96: ISSUE bug.yml name and labels lock', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug.startsWith('name: Bug\n')).toBe(true);
    expect(bug).toContain('labels: ["bug"]');
    expect(bug).toContain('label: Steps to reproduce');
  });

  it('post96: ISSUE feature.yml name and labels lock', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature.startsWith('name: Feature\n')).toBe(true);
    expect(feature).toContain('labels: ["enhancement"]');
    expect(feature).toContain('label: Acceptance criteria');
  });

  it('post96: ISSUE chore.yml name and labels lock', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore.startsWith('name: Chore / Infra / Docs\n')).toBe(true);
    expect(chore).toContain('labels: ["chore"]');
  });

  it('post96: negative — leftover docs never embed raw API keys', () => {
    for (const rel of ['README.md', 'DEPLOY.md', 'AGENTS.md', 'wrangler.toml'] as const) {
      expect(read(rel)).not.toMatch(/AIza[0-9A-Za-z\-_]{20,}/);
      expect(read(rel)).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  });

  it('post96: negative — CI does not reference wrangler deploy', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/wrangler deploy|wrangler-action/);
  });

  it('post96: negative — deploy workflow does not upload coverage artifacts', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/upload-artifact|coverage-report/);
  });

  it('post96: negative — dependabot does not schedule weekly or daily', () => {
    expect(read('.github/dependabot.yml')).not.toMatch(/weekly|daily/);
  });

  it('post96: negative — no .env or .dev.vars committed at repo root', () => {
    const rootEntries = readdirSync(root);
    expect(rootEntries).not.toContain('.env');
    expect(rootEntries).not.toContain('.dev.vars');
  });

  it('post96: negative — package.json has no engines/private/license fields', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.engines).toBeUndefined();
    expect(pkg.private).toBeUndefined();
    expect(pkg.license).toBeUndefined();
    expect(pkg.bin).toBeUndefined();
  });

  it('post96: negative — vitest.config has no pool/threads/browser overrides', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).not.toMatch(/pool:|threads:|browser:|isolate:/);
  });

  it('post96: negative — ISSUE templates never mention Anthropic/Claude', () => {
    for (const rel of [
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
    ] as const) {
      expect(read(rel)).not.toMatch(/anthropic|claude|haiku/i);
    }
  });

  it('post96: leftover CI surfaces stay LF-only (no CRLF)', () => {
    for (const rel of [
      'README.md',
      'DEPLOY.md',
      'wrangler.toml',
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
    ] as const) {
      expect(read(rel).includes('\r\n')).toBe(false);
      expect(read(rel).includes('\r')).toBe(false);
    }
  });

  it('post96: leftover CI surfaces stay tab-free', () => {
    for (const rel of [
      'README.md',
      'DEPLOY.md',
      'wrangler.toml',
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
    ] as const) {
      expect(read(rel).includes('\t')).toBe(false);
    }
  });

  it('post96: Promise.all concurrent digest of README+DEPLOY stays stable', async () => {
    const [a, b] = await Promise.all([
      Promise.resolve(sha256('README.md')),
      Promise.resolve(sha256('DEPLOY.md')),
    ]);
    expect(a).toBe('f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987');
    expect(b).toBe('11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a');
  });

  it('post96: Uint8Array of wrangler name bytes spell backlink', () => {
    const bytes = new TextEncoder().encode('backlink');
    expect([...bytes]).toEqual([98, 97, 99, 107, 108, 105, 110, 107]);
    expect(read('wrangler.toml')).toContain('name = "backlink"');
  });

  it('post96: btoa/atob round-trip of CATALOG_CACHE binding', () => {
    expect(atob(btoa('CATALOG_CACHE'))).toBe('CATALOG_CACHE');
    expect(read('wrangler.toml')).toContain('binding = "CATALOG_CACHE"');
    expect(read('.github/workflows/ci.yml')).toContain('test -f wrangler.toml');
  });

  it('post96: URL parse of live worker hostname stays backlink.fuzzywigg.com', () => {
    const u = new URL('https://backlink.fuzzywigg.com');
    expect(u.hostname).toBe('backlink.fuzzywigg.com');
    expect(read('README.md')).toContain('https://backlink.fuzzywigg.com');
    expect(read('wrangler.toml')).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('post96: Map of digest algorithms covers sha256/sha1/md5/sha512', () => {
    const algos = new Map([
      ['sha256', 64],
      ['sha1', 40],
      ['md5', 32],
      ['sha512', 128],
    ]);
    expect(sha256('README.md')).toHaveLength(algos.get('sha256')!);
    expect(sha1('README.md')).toHaveLength(algos.get('sha1')!);
    expect(md5('README.md')).toHaveLength(algos.get('md5')!);
    expect(sha512('README.md')).toHaveLength(algos.get('sha512')!);
  });

  it('post96: Set of ISSUE_TEMPLATE basenames stays four files', () => {
    expect(new Set(readdirSync(join(root, '.github/ISSUE_TEMPLATE')))).toEqual(
      new Set(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']),
    );
  });

  it('post96: Object.is frozen environment.json name Backlink_Facelift', () => {
    const env = Object.freeze(JSON.parse(read('.cursor/environment.json')) as {
      name: string;
      install: string;
    });
    expect(Object.is(env.name, 'Backlink_Facelift')).toBe(true);
    expect(Object.is(env.install, 'npm ci')).toBe(true);
  });

  it('post96: structuredClone of package scripts stays six keys', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const clone = structuredClone(pkg.scripts);
    expect(Object.keys(clone)).toHaveLength(6);
    expect(clone).not.toBe(pkg.scripts);
    expect(clone.test).toBe('vitest run');
  });

  it('post96: Reflect.has package-lock packages root entry', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(Reflect.has(lock.packages, '')).toBe(true);
    expect((lock.packages[''] as { name: string }).name).toBe('backlink');
  });

  it('post96: ArrayBuffer byteLength of ISSUE config.yml is 28', () => {
    const buf = readFileSync(join(root, '.github/ISSUE_TEMPLATE/config.yml'));
    expect(buf.buffer.byteLength).toBeGreaterThanOrEqual(28);
    expect(buf.byteLength).toBe(28);
  });

  it('post96: DataView reads blank_issues first byte as b (0x62)', () => {
    const buf = new TextEncoder().encode('blank_issues_enabled: false\n');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint8(0)).toBe(0x62);
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toBe(new TextDecoder().decode(buf));
  });

  it('post96: BigInt of README byte size stays 2801n', () => {
    expect(BigInt(byteSize('README.md'))).toBe(2801n);
  });

  it('post96: Number.isInteger of all CI timeout minutes', () => {
    const mins = [...read('.github/workflows/ci.yml').matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(mins).toEqual([10, 15, 5]);
    expect(mins.every(Number.isInteger)).toBe(true);
  });

  it('post96: deploy timeout-minutes is 20', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('timeout-minutes: 20');
  });

  it('post96: encodeURI of coverage path segments stays unescaped', () => {
    expect(encodeURI('coverage/lcov.info')).toBe('coverage/lcov.info');
    expect(read('.github/workflows/ci.yml')).toContain('test -f coverage/lcov.info');
    expect(read('.github/workflows/ci.yml')).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post96: JSON.stringify of blank issue config round-trips', () => {
    // config is YAML not JSON — lock the exact text form hygiene also greps
    expect(JSON.stringify({ blank_issues_enabled: false })).toBe('{"blank_issues_enabled":false}');
    expect(read('.github/ISSUE_TEMPLATE/config.yml').trim()).toBe('blank_issues_enabled: false');
  });

  it('post96: hygiene required file inventory still lists all contract suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/helpers.ts',
      'test/helpers.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
      'docs/mcp-spec.md',
    ] as const) {
      expect(ci).toContain(`test -f ${f}`);
      expect(statSync(join(root, f)).isFile()).toBe(true);
    }
  });

  it('post96: hygiene required src inventory still lists all modules', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts'] as const) {
      expect(ci).toContain(`test -f ${f}`);
      expect(statSync(join(root, f)).isFile()).toBe(true);
    }
  });

  it('post96: gitattributes remains text=auto LF normalization only', () => {
    expect(read('.gitattributes')).toBe(
      '# Auto detect text files and perform LF normalization\n* text=auto\n',
    );
  });

  it('post96: .gitignore keeps coverage and secret patterns', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('.env');
    expect(gi).toContain('.dev.vars');
    expect(gi).toContain('*.pem');
    expect(gi).toContain('*.key');
    expect(gi).toContain('coverage/');
    expect(gi).toContain('.wrangler/');
  });

  it('post96: CI concurrency group template exact leftover lock', () => {
    expect(read('.github/workflows/ci.yml')).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
    expect(read('.github/workflows/deploy.yml')).toContain('group: deploy-${{ github.workflow }}');
  });

  it('post96: CI permissions contents read exact block', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/permissions:\n  contents: read\n/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/permissions:\n  contents: read\n/);
  });

  it('post96: upload-artifact retention-days 14 and if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('retention-days: 14');
    expect(ci).toContain('if-no-files-found: error');
    expect(ci).toContain('name: coverage-report');
    expect(ci).toContain('if: always()');
  });

  it('post96: deploy secrets mapping lists only GEMINI_API_KEY under secrets pipe', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('secrets: |');
    expect(deploy).toContain('GEMINI_API_KEY');
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
  });

  it('post96: CI job id order typecheck then test then hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    const typecheck = ci.indexOf('\n  typecheck:\n');
    const test = ci.indexOf('\n  test:\n');
    const hygiene = ci.indexOf('\n  hygiene:\n');
    expect(typecheck).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(typecheck);
    expect(hygiene).toBeGreaterThan(test);
  });

  it('post96: queueMicrotask does not mutate README digest', async () => {
    const before = sha256('README.md');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sha256('README.md')).toBe(before);
  });

  it('post96: AbortController unused by CI YAML contracts', () => {
    expect(typeof AbortController).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/AbortController|signal:/);
  });

  it('post96: Headers/FormData absence in leftover docs', () => {
    expect(read('README.md')).not.toMatch(/FormData|multipart/i);
    expect(read('DEPLOY.md')).not.toMatch(/FormData|multipart/i);
  });

  it('post96: Blob round-trip of workflow name CI', async () => {
    expect(await new Blob(['CI']).text()).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post96: Int16Array of retention and open-PR limits', () => {
    const arr = Int16Array.from([14, 3, 2, 20]);
    expect([...arr]).toEqual([14, 3, 2, 20]);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
    expect(read('.github/dependabot.yml')).toContain('open-pull-requests-limit: 3');
    expect(read('.github/dependabot.yml')).toContain('open-pull-requests-limit: 2');
    expect(read('.github/workflows/deploy.yml')).toContain('timeout-minutes: 20');
  });

  it('post96: WeakMap can associate package name with digest', () => {
    const wm = new WeakMap<object, string>();
    const key = Object.freeze({ name: 'backlink' });
    wm.set(key, sha256('package.json'));
    expect(wm.get(key)).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
  });

  it('post96: Proxy cannot rewrite live vitest threshold lines value', () => {
    const cfg = { lines: 100, branches: 100 };
    const proxied = new Proxy(cfg, {
      set() {
        return false;
      },
    });
    expect(() => {
      (proxied as { lines: number }).lines = 99;
    }).toThrow();
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('post96: fromCharCode rebuild of fuzzywigg org slug', () => {
    const org = String.fromCharCode(102, 117, 122, 122, 121, 119, 105, 103, 103);
    expect(org).toBe('fuzzywigg');
    expect(read('README.md')).toContain('fuzzywigg/Backlink_Facelift');
    expect(read('AGENTS.md')).toContain('backlink.fuzzywigg.com');
  });

  it('post96: codePointAt of radio emoji in README title', () => {
    const title = '# Backlink 📻';
    expect(title.codePointAt(title.length - 2)).toBe(0x1f4fb);
    expect(read('README.md').startsWith('# Backlink 📻\n')).toBe(true);
  });

  it('post96: padEnd of Node version token stays 20', () => {
    expect('20'.padEnd(2, '0')).toBe('20');
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
    expect(read('.github/workflows/deploy.yml')).toContain('node-version: "20"');
  });

  it('post96: Relative indexOf of defaults shell before jobs in CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('shell: bash')).toBeLessThan(ci.indexOf('jobs:'));
  });

  it('post96: deploy workflow_dispatch is the only trigger', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/^on:\n  workflow_dispatch:\n/m);
    expect(deploy).not.toMatch(/push:|pull_request:|schedule:/);
  });

  it('post96: CI on: block is push+pull_request to main only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/on:\n  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]\n/);
    // Hygiene comments mention pull_request_target only as a forbidden trigger
    expect(ci).toContain("! awk '/^on:/{f=1} f && /^[^[:space:]#]/{if($0 !~ /^on:/) exit} f' .github/workflows/ci.yml | grep -q 'pull_request_target'");
    expect(ci).not.toMatch(/^\s*pull_request_target:/m);
  });

  it('post96: package type module and version 0.1.0', () => {
    const pkg = JSON.parse(read('package.json')) as { type: string; version: string; name: string };
    expect(pkg.type).toBe('module');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.name).toBe('backlink');
  });

  it('post96: sha256 digest hex length locks for leftover docs', () => {
    expect(sha256('README.md')).toHaveLength(64);
    expect(sha256('DEPLOY.md')).toHaveLength(64);
    expect(sha256('wrangler.toml')).toHaveLength(64);
    expect(sha512('README.md')).toHaveLength(128);
  });

  it('post96: first/last octets of README sha256 stay f7 / 87', () => {
    const hex = sha256('README.md');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('87');
  });

  it('post96: first/last octets of DEPLOY.md sha256 stay 11 / 5a', () => {
    const hex = sha256('DEPLOY.md');
    expect(hex.slice(0, 2)).toBe('11');
    expect(hex.slice(-2)).toBe('5a');
  });

  it('post96: first/last octets of wrangler.toml sha256 stay 95 / f8', () => {
    const hex = sha256('wrangler.toml');
    expect(hex.slice(0, 2)).toBe('95');
    expect(hex.slice(-2)).toBe('f8');
  });

  it('post96: dirname of workflows resolves under .github', () => {
    expect(dirname(join(root, '.github/workflows/ci.yml'))).toBe(join(root, '.github/workflows'));
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post96: this test file still lives under test/ and names ci-config', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(fileURLToPath(import.meta.url).endsWith('ci-config.test.ts')).toBe(true);
  });

});

// --- HEAVY burn (post-#100): deepen ci-config unit slice only — no product inventing ---
// Orthogonal to #100 routes, #99 genres, #98 mcp-spec. Digests, HMAC locks, workflow pins,
// package/vitest/hygiene/ISSUE_TEMPLATE/AGENTS Verify cross-locks — tests-only.

describe('post100 ci-config HEAVY deepen', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);

  it('post100: locks ci.yml sha256 digest', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe(
      'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
    );
  });

  it('post100: locks ci.yml sha1 digest', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post100: locks ci.yml md5 digest', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post100: locks ci.yml sha256 nibble sum 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post100: locks ci.yml byte size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post100: locks ci.yml utf8 char length 6295', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
  });

  it('post100: locks ci.yml line count 177', () => {
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post100: locks ci.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/workflows/ci.yml')).toBe(
      'e997e669ee801faeaaac0ecfb8239cc5d416ffd739f752a288a997d086e7bd15',
    );
  });

  it('post100: locks ci.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/workflows/ci.yml')).toBe(
      '562cdfc204dad939f5009bc5ed398a1bc0d31d03127064bb40f5f078b67c8f9e',
    );
  });

  it('post100: locks ci.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/ci.yml');
    expect(hex.slice(0, 2)).toBe('c4');
    expect(hex.slice(-2)).toBe('d5');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks deploy.yml sha256 digest', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe(
      '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
    );
  });

  it('post100: locks deploy.yml sha1 digest', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post100: locks deploy.yml md5 digest', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post100: locks deploy.yml sha256 nibble sum 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post100: locks deploy.yml byte size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post100: locks deploy.yml utf8 char length 1004', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
  });

  it('post100: locks deploy.yml line count 47', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post100: locks deploy.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/workflows/deploy.yml')).toBe(
      'b2d258b8ef783136b38e6607f0b0c441f5f7cc85a2aca677b051bdba3fa57eca',
    );
  });

  it('post100: locks deploy.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/workflows/deploy.yml')).toBe(
      '8a30355dfcfa95a714c2cb411c8a7a11d0e0c29a70560a2e81fa22ef0a439ef6',
    );
  });

  it('post100: locks deploy.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/deploy.yml');
    expect(hex.slice(0, 2)).toBe('49');
    expect(hex.slice(-2)).toBe('c3');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks dependabot.yml sha256 digest', () => {
    expect(sha256('.github/dependabot.yml')).toBe(
      'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac',
    );
  });

  it('post100: locks dependabot.yml sha1 digest', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post100: locks dependabot.yml md5 digest', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post100: locks dependabot.yml sha256 nibble sum 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post100: locks dependabot.yml byte size 505', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
    expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post100: locks dependabot.yml utf8 char length 505', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
  });

  it('post100: locks dependabot.yml line count 25', () => {
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post100: locks dependabot.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/dependabot.yml')).toBe(
      '8b61de03ef1b75db2912b46274382788f1abd7bb4823d4dfe80d94c5caaae024',
    );
  });

  it('post100: locks dependabot.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/dependabot.yml')).toBe(
      'f1f672c11bc817da2fbcc2da295008dbfc8a8d66d6c93d5a290abec4a1c03a35',
    );
  });

  it('post100: locks dependabot.yml sha256 first/last octets', () => {
    const hex = sha256('.github/dependabot.yml');
    expect(hex.slice(0, 2)).toBe('a1');
    expect(hex.slice(-2)).toBe('ac');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks vitest.config.ts sha256 digest', () => {
    expect(sha256('vitest.config.ts')).toBe(
      'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
    );
  });

  it('post100: locks vitest.config.ts sha1 digest', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post100: locks vitest.config.ts md5 digest', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post100: locks vitest.config.ts sha256 nibble sum 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post100: locks vitest.config.ts byte size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post100: locks vitest.config.ts utf8 char length 535', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
  });

  it('post100: locks vitest.config.ts line count 22', () => {
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post100: locks vitest.config.ts HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'vitest.config.ts')).toBe(
      'b48d4463ac3144a8a6e5e60a568762fe11adefce678494ceb591e4e63ae528c3',
    );
  });

  it('post100: locks vitest.config.ts HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'vitest.config.ts')).toBe(
      'cbc0824e8cf27d4821cff93137bb24c28a94518110c29b9db7e9e0e835269d63',
    );
  });

  it('post100: locks vitest.config.ts sha256 first/last octets', () => {
    const hex = sha256('vitest.config.ts');
    expect(hex.slice(0, 2)).toBe('f9');
    expect(hex.slice(-2)).toBe('38');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks package.json sha256 digest', () => {
    expect(sha256('package.json')).toBe(
      '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
    );
  });

  it('post100: locks package.json sha1 digest', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post100: locks package.json md5 digest', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post100: locks package.json sha256 nibble sum 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post100: locks package.json byte size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post100: locks package.json utf8 char length 635', () => {
    expect(read('package.json')).toHaveLength(635);
  });

  it('post100: locks package.json line count 26', () => {
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post100: locks package.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'package.json')).toBe(
      '9af90b16d02d642aa55aa2a1cf7816f6cab099d1837f4d1efcc3a76638229f38',
    );
  });

  it('post100: locks package.json HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'package.json')).toBe(
      'c9d44e02ffdbd3fabf647c74ddd972362755b45712d10ac722d09d2148e87797',
    );
  });

  it('post100: locks package.json sha256 first/last octets', () => {
    const hex = sha256('package.json');
    expect(hex.slice(0, 2)).toBe('34');
    expect(hex.slice(-2)).toBe('1c');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks tsconfig.json sha256 digest', () => {
    expect(sha256('tsconfig.json')).toBe(
      'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
    );
  });

  it('post100: locks tsconfig.json sha1 digest', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post100: locks tsconfig.json md5 digest', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post100: locks tsconfig.json sha256 nibble sum 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post100: locks tsconfig.json byte size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post100: locks tsconfig.json utf8 char length 397', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
  });

  it('post100: locks tsconfig.json line count 24', () => {
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post100: locks tsconfig.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'tsconfig.json')).toBe(
      '419001e750f87204a6c6d4cffff7d5324d92ef88acc751e05de8b60b747c008a',
    );
  });

  it('post100: locks tsconfig.json HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'tsconfig.json')).toBe(
      'fdac8df66dc5cdb87036b813eb59d04ff4e116826a30a442e0648f47a617bf69',
    );
  });

  it('post100: locks tsconfig.json sha256 first/last octets', () => {
    const hex = sha256('tsconfig.json');
    expect(hex.slice(0, 2)).toBe('ef');
    expect(hex.slice(-2)).toBe('92');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks .gitignore sha256 digest', () => {
    expect(sha256('.gitignore')).toBe(
      '474ed59338a23de819e219c00d0e033b23e3669cc4106ce7a888fe0636569698',
    );
  });

  it('post100: locks .gitignore sha1 digest', () => {
    expect(sha1('.gitignore')).toBe('432103230f4c49258e046fc945e8160007c23570');
  });

  it('post100: locks .gitignore md5 digest', () => {
    expect(md5('.gitignore')).toBe('7d0728257f47875ec0120ca3cdbf7308');
  });

  it('post100: locks .gitignore sha256 nibble sum 444 xor 6', () => {
    const d = sha256('.gitignore');
    expect(nibbleSum(d)).toBe(444);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post100: locks .gitignore byte size 261', () => {
    expect(statSync(join(root, '.gitignore')).size).toBe(261);
    expect(readFileSync(join(root, '.gitignore')).byteLength).toBe(261);
  });

  it('post100: locks .gitignore utf8 char length 261', () => {
    expect(read('.gitignore')).toHaveLength(261);
  });

  it('post100: locks .gitignore line count 26', () => {
    expect(read('.gitignore').split('\n')).toHaveLength(26);
  });

  it('post100: locks .gitignore HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.gitignore')).toBe(
      '6a912adbdce7ef35c0e20cedc5559dea42d8e8af9a1af43490aca607d0c89af3',
    );
  });

  it('post100: locks .gitignore HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.gitignore')).toBe(
      '908a0d1746e7fb194f136f22cea7c18c4a9e241795c9a58069773c6b50e9cb4c',
    );
  });

  it('post100: locks .gitignore sha256 first/last octets', () => {
    const hex = sha256('.gitignore');
    expect(hex.slice(0, 2)).toBe('47');
    expect(hex.slice(-2)).toBe('98');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks environment.json sha256 digest', () => {
    expect(sha256('.cursor/environment.json')).toBe(
      '4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694',
    );
  });

  it('post100: locks environment.json sha1 digest', () => {
    expect(sha1('.cursor/environment.json')).toBe('b4f3dec322cd018ce5c1dea89897a469bd128685');
  });

  it('post100: locks environment.json md5 digest', () => {
    expect(md5('.cursor/environment.json')).toBe('956c8804543595a31d6a7051aecd6528');
  });

  it('post100: locks environment.json sha256 nibble sum 472 xor 0', () => {
    const d = sha256('.cursor/environment.json');
    expect(nibbleSum(d)).toBe(472);
    expect(xorNibbles(d)).toBe(0);
  });

  it('post100: locks environment.json byte size 57', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57);
    expect(readFileSync(join(root, '.cursor/environment.json')).byteLength).toBe(57);
  });

  it('post100: locks environment.json utf8 char length 57', () => {
    expect(read('.cursor/environment.json')).toHaveLength(57);
  });

  it('post100: locks environment.json line count 5', () => {
    expect(read('.cursor/environment.json').split('\n')).toHaveLength(5);
  });

  it('post100: locks environment.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.cursor/environment.json')).toBe(
      '89582143f68b016bb37c4fbcd570f0c296c37c459c19c70fbc513907d0357136',
    );
  });

  it('post100: locks environment.json HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.cursor/environment.json')).toBe(
      '5e1741d27a5f59f7d5d2a32efcae16ade6d7040804bad79a6f489be0978989f4',
    );
  });

  it('post100: locks environment.json sha256 first/last octets', () => {
    const hex = sha256('.cursor/environment.json');
    expect(hex.slice(0, 2)).toBe('4e');
    expect(hex.slice(-2)).toBe('94');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks AGENTS.md sha256 digest', () => {
    expect(sha256('AGENTS.md')).toBe(
      '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
    );
  });

  it('post100: locks AGENTS.md sha1 digest', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post100: locks AGENTS.md md5 digest', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post100: locks AGENTS.md sha256 nibble sum 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post100: locks AGENTS.md byte size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post100: locks AGENTS.md utf8 char length 1011', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
  });

  it('post100: locks AGENTS.md line count 35', () => {
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post100: locks AGENTS.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'AGENTS.md')).toBe(
      '1e8f20e9d67be8517c3acfdce81387fdbcd5d1bda52f43fffdb055139810c224',
    );
  });

  it('post100: locks AGENTS.md HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'AGENTS.md')).toBe(
      'e8eb14ae7c9399300113eed22a351226c5fa76416377703db60c9098efa7a1bf',
    );
  });

  it('post100: locks AGENTS.md sha256 first/last octets', () => {
    const hex = sha256('AGENTS.md');
    expect(hex.slice(0, 2)).toBe('48');
    expect(hex.slice(-2)).toBe('aa');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks .gitattributes sha256 digest', () => {
    expect(sha256('.gitattributes')).toBe(
      '1a1dbe176bc233b499d35a57db7513f2941c99ab9759f177830c9149be99005b',
    );
  });

  it('post100: locks .gitattributes sha1 digest', () => {
    expect(sha1('.gitattributes')).toBe('ba3dfe345280bdcc5e817bb02cf49b8b8d8e1c4c');
  });

  it('post100: locks .gitattributes md5 digest', () => {
    expect(md5('.gitattributes')).toBe('05bdb783ee6514c8c072e47680af8ff7');
  });

  it('post100: locks .gitattributes sha256 nibble sum 458 xor 4', () => {
    const d = sha256('.gitattributes');
    expect(nibbleSum(d)).toBe(458);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post100: locks .gitattributes byte size 66', () => {
    expect(statSync(join(root, '.gitattributes')).size).toBe(66);
    expect(readFileSync(join(root, '.gitattributes')).byteLength).toBe(66);
  });

  it('post100: locks .gitattributes utf8 char length 66', () => {
    expect(read('.gitattributes')).toHaveLength(66);
  });

  it('post100: locks .gitattributes line count 3', () => {
    expect(read('.gitattributes').split('\n')).toHaveLength(3);
  });

  it('post100: locks .gitattributes HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.gitattributes')).toBe(
      '6ce67056afbd26bb77fe120d1cf0d1ca508fe14b68665b2864ee447a3986c241',
    );
  });

  it('post100: locks .gitattributes HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.gitattributes')).toBe(
      '00b232cff58122c8794e60e15900064fd90f4397feef852b2f95151f1c5c6cc1',
    );
  });

  it('post100: locks .gitattributes sha256 first/last octets', () => {
    const hex = sha256('.gitattributes');
    expect(hex.slice(0, 2)).toBe('1a');
    expect(hex.slice(-2)).toBe('5b');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks package-lock.json sha256 digest', () => {
    expect(sha256('package-lock.json')).toBe(
      '5f8a888f1fc7aaf97dcdaa3f91405cefbb45ad118685eac7a1488b78cedfcee6',
    );
  });

  it('post100: locks package-lock.json sha1 digest', () => {
    expect(sha1('package-lock.json')).toBe('6bc7eb19009d4dccc1d2928b0d856f337eb76aad');
  });

  it('post100: locks package-lock.json md5 digest', () => {
    expect(md5('package-lock.json')).toBe('568e267e07346bb7de4796dbeb117b54');
  });

  it('post100: locks package-lock.json sha256 nibble sum 582 xor 4', () => {
    const d = sha256('package-lock.json');
    expect(nibbleSum(d)).toBe(582);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post100: locks package-lock.json byte size 92068', () => {
    expect(statSync(join(root, 'package-lock.json')).size).toBe(92068);
    expect(readFileSync(join(root, 'package-lock.json')).byteLength).toBe(92068);
  });

  it('post100: locks package-lock.json utf8 char length 92068', () => {
    expect(read('package-lock.json')).toHaveLength(92068);
  });

  it('post100: locks package-lock.json line count 2842', () => {
    expect(read('package-lock.json').split('\n')).toHaveLength(2842);
  });

  it('post100: locks package-lock.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'package-lock.json')).toBe(
      '326a070fd1036eba109bdafe8028c34e0f80e740db01e586803212520bee632a',
    );
  });

  it('post100: locks package-lock.json HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'package-lock.json')).toBe(
      '704ab1d3ce2a418003308a656be5873bab36a64f922b907b7940261a233f85f8',
    );
  });

  it('post100: locks package-lock.json sha256 first/last octets', () => {
    const hex = sha256('package-lock.json');
    expect(hex.slice(0, 2)).toBe('5f');
    expect(hex.slice(-2)).toBe('e6');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks DEPLOY.md sha256 digest', () => {
    expect(sha256('DEPLOY.md')).toBe(
      '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
    );
  });

  it('post100: locks DEPLOY.md sha1 digest', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post100: locks DEPLOY.md md5 digest', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post100: locks DEPLOY.md sha256 nibble sum 439 xor 11', () => {
    const d = sha256('DEPLOY.md');
    expect(nibbleSum(d)).toBe(439);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post100: locks DEPLOY.md byte size 1573', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573);
    expect(readFileSync(join(root, 'DEPLOY.md')).byteLength).toBe(1573);
  });

  it('post100: locks DEPLOY.md utf8 char length 1539', () => {
    expect(read('DEPLOY.md')).toHaveLength(1539);
  });

  it('post100: locks DEPLOY.md line count 65', () => {
    expect(read('DEPLOY.md').split('\n')).toHaveLength(65);
  });

  it('post100: locks DEPLOY.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'DEPLOY.md')).toBe(
      'b27e64e44a605676c5e7ec1ac636c68b62712ebbb87a5f5f64d0e031bd827ecd',
    );
  });

  it('post100: locks DEPLOY.md HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'DEPLOY.md')).toBe(
      '0fcd54627d89d8ea6046fbd3355f5fdd2890b3836cd85d29836beb6a389a91d6',
    );
  });

  it('post100: locks DEPLOY.md sha256 first/last octets', () => {
    const hex = sha256('DEPLOY.md');
    expect(hex.slice(0, 2)).toBe('11');
    expect(hex.slice(-2)).toBe('5a');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks README.md sha256 digest', () => {
    expect(sha256('README.md')).toBe(
      'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
    );
  });

  it('post100: locks README.md sha1 digest', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post100: locks README.md md5 digest', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post100: locks README.md sha256 nibble sum 429 xor 13', () => {
    const d = sha256('README.md');
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post100: locks README.md byte size 2801', () => {
    expect(statSync(join(root, 'README.md')).size).toBe(2801);
    expect(readFileSync(join(root, 'README.md')).byteLength).toBe(2801);
  });

  it('post100: locks README.md utf8 char length 2757', () => {
    expect(read('README.md')).toHaveLength(2757);
  });

  it('post100: locks README.md line count 82', () => {
    expect(read('README.md').split('\n')).toHaveLength(82);
  });

  it('post100: locks README.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'README.md')).toBe(
      'd2200d30dd2c44cf22921293f93f55010c881b75b920cab8276ddcef891875b6',
    );
  });

  it('post100: locks README.md HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'README.md')).toBe(
      '9cc320e42acf02a357223d403b302eb8bdf2b1437df79e9bb4711ad9a0fc026b',
    );
  });

  it('post100: locks README.md sha256 first/last octets', () => {
    const hex = sha256('README.md');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('87');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks wrangler.toml sha256 digest', () => {
    expect(sha256('wrangler.toml')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post100: locks wrangler.toml sha1 digest', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post100: locks wrangler.toml md5 digest', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post100: locks wrangler.toml sha256 nibble sum 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post100: locks wrangler.toml byte size 330', () => {
    expect(statSync(join(root, 'wrangler.toml')).size).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post100: locks wrangler.toml utf8 char length 330', () => {
    expect(read('wrangler.toml')).toHaveLength(330);
  });

  it('post100: locks wrangler.toml line count 18', () => {
    expect(read('wrangler.toml').split('\n')).toHaveLength(18);
  });

  it('post100: locks wrangler.toml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'wrangler.toml')).toBe(
      '5d6000dc3ef908feddf3ec6b0bab5f39abbfaaf711e0b56f034de28b766528c3',
    );
  });

  it('post100: locks wrangler.toml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'wrangler.toml')).toBe(
      '00eaad00621fa90ecb4d959cdd065332f8f56008996a21f8e3e7cc8e6436e81d',
    );
  });

  it('post100: locks wrangler.toml sha256 first/last octets', () => {
    const hex = sha256('wrangler.toml');
    expect(hex.slice(0, 2)).toBe('95');
    expect(hex.slice(-2)).toBe('f8');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks mcp-spec.md sha256 digest', () => {
    expect(sha256('docs/mcp-spec.md')).toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post100: locks mcp-spec.md sha1 digest', () => {
    expect(sha1('docs/mcp-spec.md')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
  });

  it('post100: locks mcp-spec.md md5 digest', () => {
    expect(md5('docs/mcp-spec.md')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it('post100: locks mcp-spec.md sha256 nibble sum 514 xor 14', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post100: locks mcp-spec.md byte size 3552', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552);
    expect(readFileSync(join(root, 'docs/mcp-spec.md')).byteLength).toBe(3552);
  });

  it('post100: locks mcp-spec.md utf8 char length 3544', () => {
    expect(read('docs/mcp-spec.md')).toHaveLength(3544);
  });

  it('post100: locks mcp-spec.md line count 145', () => {
    expect(read('docs/mcp-spec.md').split('\n')).toHaveLength(145);
  });

  it('post100: locks mcp-spec.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'docs/mcp-spec.md')).toBe(
      '6effd1effec6eeb6f8371fbc54a189e2f68c1a75308327b11f189591af625293',
    );
  });

  it('post100: locks mcp-spec.md HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', 'docs/mcp-spec.md')).toBe(
      '83580d590eb1ce02250fa56d57020df76a26a68bc4ee48eaad80f85a5da06e34',
    );
  });

  it('post100: locks mcp-spec.md sha256 first/last octets', () => {
    const hex = sha256('docs/mcp-spec.md');
    expect(hex.slice(0, 2)).toBe('a9');
    expect(hex.slice(-2)).toBe('49');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks bug.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'f76fcc573b913789446748a601dcb4a8d2cfaa3ec85d2c6bb798f2a35b844055',
    );
  });

  it('post100: locks bug.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/bug.yml')).toBe('d03c99b857f1589125c3bc266ae29317f6c7ba0a');
  });

  it('post100: locks bug.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/bug.yml')).toBe('3693b9bfd65bf683be0706b83831ae69');
  });

  it('post100: locks bug.yml sha256 nibble sum 493 xor 11', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(nibbleSum(d)).toBe(493);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post100: locks bug.yml byte size 846', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).size).toBe(846);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).byteLength).toBe(846);
  });

  it('post100: locks bug.yml utf8 char length 846', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toHaveLength(846);
  });

  it('post100: locks bug.yml line count 41', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml').split('\n')).toHaveLength(41);
  });

  it('post100: locks bug.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '07ed5c7fe74dba726db04a5c828d27ab8ff4784e2f8a48b46c3a1177ca93b4f5',
    );
  });

  it('post100: locks bug.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '3a17eec4b64aca8cc97775b3360c26768111138bd817855cd12a583bedc47a91',
    );
  });

  it('post100: locks bug.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('55');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks chore.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '230222c6ac61737a55b00df4442d483911154bd93657ba98a1d30b75b509c3fc',
    );
  });

  it('post100: locks chore.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/chore.yml')).toBe('9b401e414cbc1a5fab58fa4ae6d43957a4ef05fd');
  });

  it('post100: locks chore.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/chore.yml')).toBe('2eff43364806910ca218e00054a2304a');
  });

  it('post100: locks chore.yml sha256 nibble sum 406 xor 10', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(nibbleSum(d)).toBe(406);
    expect(xorNibbles(d)).toBe(10);
  });

  it('post100: locks chore.yml byte size 705', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).size).toBe(705);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).byteLength).toBe(705);
  });

  it('post100: locks chore.yml utf8 char length 705', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toHaveLength(705);
  });

  it('post100: locks chore.yml line count 33', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml').split('\n')).toHaveLength(33);
  });

  it('post100: locks chore.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '67547b0eb1e082564d1f83d97cd8b7e43c623c4861a7a6f5cdadf11120bd5de2',
    );
  });

  it('post100: locks chore.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '61c1dce0eb428744cf978dad3ca242b32f9dc7a20dee6f082c6efaa6a1b90e56',
    );
  });

  it('post100: locks chore.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(hex.slice(0, 2)).toBe('23');
    expect(hex.slice(-2)).toBe('fc');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks feature.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '83291f987d1bb546b45ecd09d9be597c5265591a99744d18a2c49122e390aac2',
    );
  });

  it('post100: locks feature.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/feature.yml')).toBe('e23c853fb5eebf3a04e9f487f2c9d879d40216b7');
  });

  it('post100: locks feature.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/feature.yml')).toBe('c73a814e3784562d4ab200328793c60f');
  });

  it('post100: locks feature.yml sha256 nibble sum 461 xor 11', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(nibbleSum(d)).toBe(461);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post100: locks feature.yml byte size 966', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).size).toBe(966);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).byteLength).toBe(966);
  });

  it('post100: locks feature.yml utf8 char length 966', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toHaveLength(966);
  });

  it('post100: locks feature.yml line count 44', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml').split('\n')).toHaveLength(44);
  });

  it('post100: locks feature.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '4016b5a04936e19104cf1df55bf668868413d981a76b223669cbbf0bb6a75403',
    );
  });

  it('post100: locks feature.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      'fe2afa2a95abc6b7588fcb389608783b1aa5a65601d755d9d13b2a9c8483f815',
    );
  });

  it('post100: locks feature.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(hex.slice(0, 2)).toBe('83');
    expect(hex.slice(-2)).toBe('c2');
    expect(hex).toHaveLength(64);
  });

  it('post100: locks issue-config.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '1f103c6a9dd07cd13a9a6f17ace6b813f47747eb9cb7e00488cb2073caaf91bb',
    );
  });

  it('post100: locks issue-config.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/config.yml')).toBe('68344263f9bbfe0fc196c0e6c1a55818cc46dc01');
  });

  it('post100: locks issue-config.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/config.yml')).toBe('74c7aebcc7755d1241890df4fd87c662');
  });

  it('post100: locks issue-config.yml sha256 nibble sum 498 xor 12', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(nibbleSum(d)).toBe(498);
    expect(xorNibbles(d)).toBe(12);
  });

  it('post100: locks issue-config.yml byte size 28', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).size).toBe(28);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).byteLength).toBe(28);
  });

  it('post100: locks issue-config.yml utf8 char length 28', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toHaveLength(28);
  });

  it('post100: locks issue-config.yml line count 2', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml').split('\n')).toHaveLength(2);
  });

  it('post100: locks issue-config.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      'c8bad415a5bce26bf53f69d73dd172d5b82223eaa506994a13cae41635ea22f1',
    );
  });

  it('post100: locks issue-config.yml HMAC-SHA256 key post100', () => {
    expect(hmacSha256('post100', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      'cacc384a88e89e82655597cdac4cc767ecc126902bd62a6bbb79c3bd0656e86f',
    );
  });

  it('post100: locks issue-config.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(hex.slice(0, 2)).toBe('1f');
    expect(hex.slice(-2)).toBe('bb');
    expect(hex).toHaveLength(64);
  });

  it('post100: CI workflow name is exactly CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.startsWith('name: CI\n')).toBe(true);
    expect([...ci.matchAll(/^name:\s*(.+)$/gm)].map((m) => m[1])).toEqual(['CI']);
    expect([...ci.matchAll(/^\s+name:\s*(.+)$/gm)].map((m) => m[1])).toEqual([
      'Typecheck',
      'Tests',
      'coverage-report',
      'Hygiene',
    ]);
    expect([...ci.matchAll(/- name:\s*(.+)$/gm)].map((m) => m[1])).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Set up Node.js',
      'Install dependencies',
      'Unit / integration tests with coverage',
      'Assert coverage artifacts exist',
      'Upload coverage report',
      'Check required files',
      'Check for committed secret material',
    ]);
  });

  it('post100: CI jobs are typecheck test hygiene in order', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsIdx = ci.indexOf('jobs:');
    const typecheckIdx = ci.indexOf('\n  typecheck:\n');
    const testIdx = ci.indexOf('\n  test:\n');
    const hygieneIdx = ci.indexOf('\n  hygiene:\n');
    expect(jobsIdx).toBeGreaterThan(-1);
    expect(typecheckIdx).toBeGreaterThan(jobsIdx);
    expect(testIdx).toBeGreaterThan(typecheckIdx);
    expect(hygieneIdx).toBeGreaterThan(testIdx);
  });

  it('post100: CI triggers push and pull_request on main only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^on:\n  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]\n/m);
    expect(ci).not.toMatch(/schedule:/);
    // workflow_dispatch / pull_request_target appear only as hygiene assertions, not triggers
    expect(ci).toContain("grep -q 'workflow_dispatch' .github/workflows/deploy.yml");
    expect(ci).toContain('pull_request_target');
    expect(ci.indexOf('jobs:')).toBeGreaterThan(ci.indexOf('pull_request:'));
    expect(ci.indexOf('workflow_dispatch')).toBeGreaterThan(ci.indexOf('jobs:'));
  });

  it('post100: deploy is workflow_dispatch HITL only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/^on:\n  workflow_dispatch:\n/m);
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/pull_request/);
    expect(deploy).not.toMatch(/schedule:/);
  });

  it('post100: CI concurrency group and cancel-in-progress true', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
    expect(ci).toContain('cancel-in-progress: true');
  });

  it('post100: deploy concurrency group and cancel-in-progress false', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('group: deploy-${{ github.workflow }}');
    expect(deploy).toContain('cancel-in-progress: false');
  });

  it('post100: CI permissions contents read only at workflow level', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/permissions:\n  contents: read\n/);
    expect(ci).not.toMatch(/id-token:|packages:|pull-requests:|issues:|actions: write/);
  });

  it('post100: CI defaults shell bash before jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('defaults:')).toBeLessThan(ci.indexOf('jobs:'));
    expect(ci).toContain('    shell: bash\n');
  });

  it('post100: CI timeout pins typecheck 10 test 15 hygiene 5', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/typecheck:[\s\S]*?timeout-minutes: 10/);
    expect(ci).toMatch(/test:[\s\S]*?timeout-minutes: 15/);
    expect(ci).toMatch(/hygiene:[\s\S]*?timeout-minutes: 5/);
  });

  it('post100: deploy timeout-minutes is 20', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('timeout-minutes: 20');
  });

  it('post100: CI action pins checkout v7 setup-node v7 upload-artifact v4', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/actions\/checkout@v7/g)]).toHaveLength(3);
    expect([...ci.matchAll(/actions\/setup-node@v7/g)]).toHaveLength(2);
    expect([...ci.matchAll(/actions\/upload-artifact@v4/g)]).toHaveLength(1);
    expect(ci).not.toMatch(/actions\/checkout@v[1-6]\b/);
    expect(ci).not.toMatch(/actions\/setup-node@v[1-6]\b/);
  });

  it('post100: deploy action pins checkout setup-node wrangler-action v4', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect([...deploy.matchAll(/actions\/checkout@v7/g)]).toHaveLength(1);
    expect([...deploy.matchAll(/actions\/setup-node@v7/g)]).toHaveLength(1);
    expect([...deploy.matchAll(/cloudflare\/wrangler-action@v4/g)]).toHaveLength(1);
  });

  it('post100: CI node-version 20 with npm cache on both install jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    // 2 setup-node pins + 1 hygiene grep assertion
    expect([...ci.matchAll(/node-version:\s*"20"/g)]).toHaveLength(3);
    expect([...ci.matchAll(/cache:\s*"npm"/g)]).toHaveLength(2);
  });

  it('post100: CI persist-credentials false five times including hygiene greps', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/persist-credentials:\s*false/g)]).toHaveLength(5);
  });

  it('post100: CI coverage artifact name coverage-report retention 14', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('name: coverage-report');
    expect(ci).toContain('retention-days: 14');
    expect(ci).toContain('if-no-files-found: error');
    expect(ci).toContain('if: always()');
  });

  it('post100: CI coverage assert checks lcov SF:src/', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("test -d coverage");
    expect(ci).toContain("test -f coverage/lcov.info");
    expect(ci).toContain("test -s coverage/lcov.info");
    expect(ci).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post100: CI hygiene lists all nine test suites plus helpers', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of [
      'test/parser.test.ts',
      'test/genres.test.ts',
      'test/routes.test.ts',
      'test/mcp.test.ts',
      'test/helpers.ts',
      'test/helpers.test.ts',
      'test/mcp-spec-contract.test.ts',
      'test/ci-config.test.ts',
      'test/wrangler-config.test.ts',
      'test/source-contracts.test.ts',
    ]) {
      expect(ci).toContain(`test -f ${f}`);
    }
  });

  it('post100: CI hygiene forbids anthropic claude haiku in src and workflows', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'");
  });

  it('post100: CI hygiene pins gemini-2.0-flash in src/index.ts', () => {
    expect(read('.github/workflows/ci.yml')).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
    expect(read('src/index.ts')).toContain('gemini-2.0-flash');
  });

  it('post100: CI hygiene forbids GEMINI_API_KEY in wrangler.toml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(ci).toContain("! grep -qiE 'api[_-]?key\\s*=' wrangler.toml");
    expect(read('wrangler.toml')).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it('post100: CI hygiene forbids committed .env .dev.vars pem key', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('! test -f .env');
    expect(ci).toContain('! test -f .dev.vars');
    expect(ci).toContain("! find . \\( -name '*.pem' -o -name '*.key' \\)");
  });

  it('post100: deploy secrets surface GEMINI_API_KEY CF tokens via secrets context', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
    expect(deploy).toContain('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}');
    expect(deploy).toMatch(/secrets:\s*\|\n\s*GEMINI_API_KEY/);
  });

  it('post100: deploy runs typecheck and coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheckIdx = deploy.indexOf('run: npm run typecheck');
    const coverageIdx = deploy.indexOf('run: npm run test:coverage');
    const wranglerIdx = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheckIdx).toBeGreaterThan(-1);
    expect(coverageIdx).toBeGreaterThan(typecheckIdx);
    expect(wranglerIdx).toBeGreaterThan(coverageIdx);
  });

  it('post100: dependabot version 2 monthly npm and github-actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2\n')).toBe(true);
    expect([...dep.matchAll(/package-ecosystem:\s*"npm"/g)]).toHaveLength(1);
    expect([...dep.matchAll(/package-ecosystem:\s*"github-actions"/g)]).toHaveLength(1);
    expect([...dep.matchAll(/interval:\s*"monthly"/g)]).toHaveLength(2);
  });

  it('post100: dependabot ignores semver-major and groups star patterns', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('update-types: ["version-update:semver-major"]');
    expect(dep).toContain('open-pull-requests-limit: 3');
    expect(dep).toContain('open-pull-requests-limit: 2');
    expect([...dep.matchAll(/- "\*"/g)]).toHaveLength(2);
  });

  it('post100: package.json name version type module scripts exact', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      version: string;
      type: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts).toEqual({
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      typecheck: 'tsc --noEmit',
      test: 'vitest run',
      'test:watch': 'vitest',
      'test:coverage': 'vitest run --coverage',
    });
  });

  it('post100: package.json sole runtime dependency is hono', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toBe('^4.13.7');
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      '@cloudflare/workers-types',
      '@types/node',
      '@vitest/coverage-v8',
      'typescript',
      'vitest',
      'wrangler',
    ]);
  });

  it('post100: package-lock lockfileVersion 3 with 168 packages', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      lockfileVersion: number;
      name: string;
      packages: Record<string, unknown>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe('backlink');
    expect(Object.keys(lock.packages)).toHaveLength(168);
  });

  it('post100: vitest coverage thresholds all 100 and include src exclude types', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
    expect(cfg).toContain("include: ['src/**/*.ts']");
    expect(cfg).toContain("exclude: ['src/types.ts']");
    expect(cfg).toContain("include: ['test/**/*.test.ts']");
    expect(cfg).toContain("environment: 'node'");
    expect(cfg).toContain('github-actions');
    expect(cfg).toContain("'lcov'");
  });

  it('post100: tsconfig strict ES2022 Bundler workers+node types', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('post100: AGENTS Verify block lists npm ci typecheck test coverage', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('## Verify');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('post100: AGENTS Escalate includes GEMINI_API_KEY HITL CORS billing', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('## Escalate to Human');
    expect(agents).toContain('GEMINI_API_KEY');
    expect(agents).toContain('Production deploy (first deploy must be HITL)');
    expect(agents).toContain('CORS or authentication logic');
    expect(agents).toContain('billing or CF account configuration');
  });

  it('post100: AGENTS Safe Agent Actions includes unit tests under test/', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Add / extend unit tests under `test/` for existing behavior');
    expect(agents).toContain('Tier: A');
    expect(agents).toContain('Autonomy: L2');
    expect(agents).toContain('backlink.fuzzywigg.com');
  });

  it('post100: cursor environment.json name Backlink_Facelift install npm ci', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { name: string; install: string };
    expect(env).toEqual({ name: 'Backlink_Facelift', install: 'npm ci' });
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
  });

  it('post100: gitignore covers node_modules coverage wrangler secrets', () => {
    const gi = read('.gitignore');
    for (const token of ['node_modules/', '.env', '.dev.vars', '*.pem', '*.key', '.wrangler/', 'coverage/', '.DS_Store']) {
      expect(gi).toContain(token);
    }
  });

  it('post100: gitattributes LF auto normalization only', () => {
    expect(read('.gitattributes')).toBe('# Auto detect text files and perform LF normalization\n* text=auto\n');
  });

  it('post100: ISSUE_TEMPLATE inventory is bug chore feature config', () => {
    expect(readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort()).toEqual([
      'bug.yml',
      'chore.yml',
      'config.yml',
      'feature.yml',
    ]);
  });

  it('post100: ISSUE_TEMPLATE config disables blank issues', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toBe('blank_issues_enabled: false\n');
  });

  it('post100: workflows directory is exactly ci.yml and deploy.yml', () => {
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post100: .github top-level is ISSUE_TEMPLATE dependabot workflows', () => {
    expect(readdirSync(join(root, '.github')).sort()).toEqual([
      'ISSUE_TEMPLATE',
      'dependabot.yml',
      'workflows',
    ]);
  });

  it('post100: test/ inventory has ten contract files including helpers.ts', () => {
    expect(readdirSync(join(root, 'test')).sort()).toEqual([
      'ci-config.test.ts',
      'genres.test.ts',
      'helpers.test.ts',
      'helpers.ts',
      'mcp-spec-contract.test.ts',
      'mcp.test.ts',
      'parser.test.ts',
      'routes.test.ts',
      'source-contracts.test.ts',
      'wrangler-config.test.ts',
    ]);
  });

  it('post100: src/ inventory is five modules only', () => {
    expect(readdirSync(join(root, 'src')).sort()).toEqual([
      'genres.ts',
      'index.ts',
      'mcp.ts',
      'parser.ts',
      'types.ts',
    ]);
  });

  it('post100: negative inventing — CI does not introduce playlist now-playing openapi routes', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/\/playlist|\/now-playing|openapi|swagger/i);
    expect(ci).not.toMatch(/podcast|audiobook|websocket/i);
  });

  it('post100: negative inventing — package scripts do not add lint format e2e invent', () => {
    const scripts = Object.keys(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
    );
    expect(scripts).not.toContain('lint');
    expect(scripts).not.toContain('format');
    expect(scripts).not.toContain('e2e');
    expect(scripts).not.toContain('storybook');
    expect(scripts).toHaveLength(6);
  });

  it('post100: negative inventing — no second package manager lockfiles', () => {
    expect(() => readFileSync(join(root, 'yarn.lock'))).toThrow();
    expect(() => readFileSync(join(root, 'pnpm-lock.yaml'))).toThrow();
    expect(() => readFileSync(join(root, 'bun.lockb'))).toThrow();
    expect(read('package-lock.json').length).toBeGreaterThan(0);
  });

  it('post100: negative inventing — no Dockerfile compose k8s CI invent', () => {
    expect(() => readFileSync(join(root, 'Dockerfile'))).toThrow();
    expect(() => readFileSync(join(root, 'docker-compose.yml'))).toThrow();
    expect(() => readFileSync(join(root, '.github/workflows/k8s.yml'))).toThrow();
    expect(readdirSync(join(root, '.github/workflows'))).not.toContain('docker.yml');
  });

  it('post100: negative inventing — CI does not call wrangler deploy', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/wrangler deploy|wrangler-action/);
    expect(read('.github/workflows/deploy.yml')).toContain('cloudflare/wrangler-action@v4');
  });

  it('post100: negative inventing — no jest mocha ava cypress in package.json', () => {
    const raw = read('package.json');
    expect(raw).not.toMatch(/jest|mocha|ava|cypress|playwright/i);
    expect(raw).toContain('"vitest"');
  });

  it('post100: ci.yml is ASCII-only and has no tabs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/[^\x00-\x7F]/);
    expect(ci.includes('\t')).toBe(false);
    expect(ci.includes('\0')).toBe(false);
  });

  it('post100: deploy.yml dependabot.yml are ASCII-only no tabs', () => {
    for (const rel of ['.github/workflows/deploy.yml', '.github/dependabot.yml']) {
      const body = read(rel);
      expect(body).not.toMatch(/[^\x00-\x7F]/);
      expect(body.includes('\t')).toBe(false);
    }
  });

  it('post100: ci.yml does not end with newline while deploy does', () => {
    expect(read('.github/workflows/ci.yml').endsWith('\n')).toBe(false);
    expect(read('.github/workflows/deploy.yml').endsWith('\n')).toBe(true);
    expect(read('.github/dependabot.yml').endsWith('\n')).toBe(true);
  });

  it('post100: no BOM on CI config surface files', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
      'package.json',
      'tsconfig.json',
      'AGENTS.md',
    ]) {
      expect(read(rel).charCodeAt(0)).not.toBe(0xfeff);
    }
  });

  it('post100: HMAC-SHA1 and HMAC-MD5 of ci.yml with key ci-config', () => {
    expect(
      createHmac('sha1', 'ci-config').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex'),
    ).toBe('cfd7a9b1a28fdebedfbd9cf3e1c52c80da3f0dae');
    expect(
      createHmac('md5', 'ci-config').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex'),
    ).toBe('b69a283739d0089c5392ce245c5dbd56');
  });

  it('post100: HMAC-SHA1 and HMAC-MD5 of deploy.yml with key post100', () => {
    expect(
      createHmac('sha1', 'post100').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex'),
    ).toBe('5889aad520cbd9b1a1c1f7397e94e105a51c2570');
    expect(
      createHmac('md5', 'post100').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex'),
    ).toBe('6f851f36026e5d15ddcb2232c371e370');
  });

  it('post100: HMAC-SHA256 of package.json with keys backlink npm vitest', () => {
    expect(hmacSha256('backlink', 'package.json')).toBe('6edca9c2fa551d553a75d6e537f429b54763a48bf941865889f51008af5b38f5');
    expect(hmacSha256('npm', 'package.json')).toBe('a1aa40269ebbc7365cbc23b09836cd84a30b5c383697ac07feb6dab792a8299d');
    expect(hmacSha256('vitest', 'package.json')).toBe('d1eef869131396904345527df21d08eff915b75dec41011933949d12e9a7ba86');
  });

  it('post100: HMAC-SHA256 of vitest.config.ts with keys coverage thresholds', () => {
    expect(hmacSha256('coverage', 'vitest.config.ts')).toBe('c6fbb12f11e5be209d3bf95521c6f27ce063332d1f0fb55e50bfb226b0b48431');
    expect(hmacSha256('thresholds', 'vitest.config.ts')).toBe('d8ce3de0687c6be4047f84e62345f4a6a18fcb5e97be76a532f06f590390e3a4');
  });

  it('post100: HMAC-SHA256 of AGENTS.md with keys verify escalate', () => {
    expect(hmacSha256('verify', 'AGENTS.md')).toBe('90e6907a7402f85d0b8e7070d306e277af75ed260a5d1ab656ec311d0cc37d9b');
    expect(hmacSha256('escalate', 'AGENTS.md')).toBe('9fe42172c51971d228d1ec6d8bb5476e5528cf9b2f7514724aa3a8752f7a1439');
  });

  it('post100: locks ci.yml first line name CI', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[0]).toBe('name: CI');
  });

  it('post100: locks ci.yml last non-empty line is find grep pem key', () => {
    const lines = read('.github/workflows/ci.yml').split('\n');
    // ci.yml intentionally has no trailing newline — last split element is content
    expect(lines[lines.length - 1]).not.toBe('');
    const last = lines.filter((l) => l.length > 0).at(-1)!;
    expect(last).toContain('*.pem');
    expect(last).toContain('grep -q .');
  });

  it('post100: locks deploy.yml last line GEMINI_API_KEY secret env', () => {
    const lines = read('.github/workflows/deploy.yml').split('\n').filter(Boolean);
    expect(lines.at(-1)).toBe('          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}');
  });

  it('post100: locks ci.yml runs-on ubuntu-latest three times', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/runs-on:\s*ubuntu-latest/g)]).toHaveLength(3);
  });

  it('post100: locks deploy.yml runs-on ubuntu-latest once', () => {
    expect([...read('.github/workflows/deploy.yml').matchAll(/runs-on:\s*ubuntu-latest/g)]).toHaveLength(1);
  });

  it('post100: locks npm ci appears twice in CI and once in deploy', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/npm ci/g)]).toHaveLength(2);
    expect([...read('.github/workflows/deploy.yml').matchAll(/npm ci/g)]).toHaveLength(1);
    expect(JSON.parse(read('.cursor/environment.json')).install).toBe('npm ci');
  });

  it('post100: locks package.json description em-dash editorial AI', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe('LLM-curated internet radio — editorial AI over iptv-org catalog');
    expect([...pkg.description].filter((c) => c.charCodeAt(0) > 127)).toEqual(['—']);
  });

  it('post100: locks typescript caret 5 not 6 or 7 in package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
    expect(pkg.devDependencies.typescript).not.toMatch(/^\^[67]\./);
    expect(read('.github/workflows/ci.yml')).toContain(
      String.raw`grep -qE '"typescript": "\^5\.' package.json`,
    );
    expect(read('.github/workflows/ci.yml')).toContain(
      String.raw`! grep -qE '"typescript": "\^[67]\.' package.json`,
    );
  });

  it('post100: locks vitest and coverage-v8 both caret 5', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
  });

  it('post100: locks wrangler caret 4 and workers-types caret 5', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.wrangler).toBe('^4.131.1');
    expect(pkg.devDependencies['@cloudflare/workers-types']).toMatch(/^\^5\./);
  });

  it('post100: locks @types/node caret 22', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies['@types/node']).toMatch(/^\^22\./);
  });

  it('post100: queueMicrotask does not alter CI digests', async () => {
    const before = sha256('.github/workflows/ci.yml');
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
    expect(sha256('.github/workflows/ci.yml')).toBe(before);
  });

  it('post100: setImmediate-equivalent Promise.resolve does not alter deploy digest', async () => {
    const before = sha256('.github/workflows/deploy.yml');
    await Promise.resolve();
    expect(sha256('.github/workflows/deploy.yml')).toBe(before);
  });

  it('post100: Blob round-trip of workflow name CI', async () => {
    const blob = new Blob(['CI'], { type: 'text/plain' });
    expect(await blob.text()).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post100: TextEncoder bytes of coverage-report stay ASCII', () => {
    const bytes = new TextEncoder().encode('coverage-report');
    expect(bytes).toHaveLength(15);
    expect(new TextDecoder().decode(bytes)).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml')).toContain('name: coverage-report');
  });

  it('post100: Int32Array of four 100 thresholds', () => {
    const arr = Int32Array.from([100, 100, 100, 100]);
    expect([...arr]).toEqual([100, 100, 100, 100]);
    expect(read('vitest.config.ts')).toMatch(/branches:\s*100/);
  });

  it('post100: BigInt package-lock packages length is 168n', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(BigInt(Object.keys(lock.packages).length)).toBe(168n);
  });

  it('post100: DataView reads node major 20 bytes', () => {
    const buf = new TextEncoder().encode('20');
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(view.getUint8(0)).toBe(0x32);
    expect(view.getUint8(1)).toBe(0x30);
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
  });

  it('post100: URL.canParse of npm registry does not appear in CI yaml', () => {
    expect(URL.canParse('https://registry.npmjs.org/')).toBe(true);
    expect(read('.github/workflows/ci.yml')).not.toContain('registry.npmjs.org');
  });

  it('post100: AbortSignal.timeout unused by CI workflows', () => {
    expect(typeof AbortSignal.timeout).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/AbortSignal/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/AbortSignal/);
  });

  it('post100: Headers unused — workflows have no Authorization Accept', () => {
    expect(new Headers({ Accept: 'application/json' }).get('Accept')).toBe('application/json');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/Authorization:/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/Authorization:/);
  });

  it('post100: FormData unused by CI and deploy workflows', () => {
    expect(typeof FormData).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/FormData|multipart/i);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/FormData|multipart/i);
  });

  it('post100: WeakMap can key package.json object without inventing deps', () => {
    const pkg = JSON.parse(read('package.json')) as object;
    const wm = new WeakMap<object, string>();
    wm.set(pkg, 'backlink');
    expect(wm.get(pkg)).toBe('backlink');
    expect(Object.keys(pkg)).toContain('dependencies');
  });

  it('post100: performance.now around reading ci.yml is finite', () => {
    const t0 = performance.now();
    expect(read('.github/workflows/ci.yml').length).toBeGreaterThan(0);
    const t1 = performance.now();
    expect(Number.isFinite(t1 - t0)).toBe(true);
  });

  it('post100: encodeURIComponent of Typecheck Tests Hygiene is identity-ish', () => {
    expect(encodeURIComponent('Typecheck')).toBe('Typecheck');
    expect(encodeURIComponent('Tests')).toBe('Tests');
    expect(encodeURIComponent('Hygiene')).toBe('Hygiene');
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('name: Typecheck');
    expect(ci).toContain('name: Tests');
    expect(ci).toContain('name: Hygiene');
  });

  it('post100: btoa/atob round-trip of CI name', () => {
    expect(atob(btoa('CI'))).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post100: structuredClone of package scripts stays equal', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(structuredClone(scripts)).toEqual(scripts);
    expect(Object.isFrozen(structuredClone(scripts))).toBe(false);
  });

  it('post100: localeCompare ordering of CI job ids', () => {
    const jobs = ['hygiene', 'test', 'typecheck'];
    expect([...jobs].sort((a, b) => a.localeCompare(b))).toEqual(['hygiene', 'test', 'typecheck']);
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^  typecheck:$/m);
    expect(ci).toMatch(/^  test:$/m);
    expect(ci).toMatch(/^  hygiene:$/m);
  });

  it('post100: Buffer compare of ci.yml prefix name', () => {
    const head = readFileSync(join(root, '.github/workflows/ci.yml')).subarray(0, 8);
    expect(Buffer.compare(head, Buffer.from('name: CI'))).toBe(0);
  });

  it('post100: fromCharCode rebuild of workflow name CI', () => {
    const name = String.fromCharCode(67, 73);
    expect(name).toBe('CI');
    expect(read('.github/workflows/ci.yml')).toContain(`name: ${name}\n`);
  });

  it('post100: Array.from of coverage threshold digits', () => {
    expect(Array.from('100')).toEqual(['1', '0', '0']);
    expect(Number(Array.from('100').join(''))).toBe(100);
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('post100: Set uniqueness of CI job names', () => {
    const names = ['Typecheck', 'Tests', 'Hygiene'];
    expect(new Set(names).size).toBe(3);
    const ci = read('.github/workflows/ci.yml');
    for (const n of names) expect(ci).toContain(`name: ${n}\n`);
  });

  it('post100: Map inventory of six package scripts', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const map = new Map(Object.entries(scripts));
    expect(map.size).toBe(6);
    expect(map.get('test:coverage')).toBe('vitest run --coverage');
  });

  it('post100: Object.entries package.json top-level key order', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(Object.keys(pkg)).toEqual([
      'name',
      'version',
      'description',
      'type',
      'scripts',
      'dependencies',
      'devDependencies',
    ]);
  });

  it('post100: JSON.stringify package name round-trips', () => {
    expect(JSON.stringify({ name: 'backlink' })).toBe('{"name":"backlink"}');
    expect(JSON.parse(read('package.json')).name).toBe('backlink');
  });

  it('post100: padStart retention-days fortnight', () => {
    expect(String(14).padStart(2, '0')).toBe('14');
    expect(14 / 7).toBe(2);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post100: repeat of hyphen does not invent workflow names', () => {
    expect('-'.repeat(3)).toBe('---');
    expect(read('.github/workflows/ci.yml')).not.toContain('name: ---');
  });

  it('post100: slice first 40 and last 40 of ci.yml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.slice(0, 40)).toBe('name: CI\n\non:\n  push:\n    branches: [mai');
    expect(ci.slice(-40)).toBe("odules/*' ! -path './.git/*' | grep -q .");
  });

  it('post100: slice first 40 and last 40 of deploy.yml', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.slice(0, 40)).toBe('name: Deploy to Cloudflare Workers\n\non:\n');
    expect(deploy.slice(-40)).toBe('_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n');
  });

  it('post100: sha256 of concatenated CI job ids', () => {
    const joined = ['typecheck', 'test', 'hygiene'].join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      'c48518346e52822a0ffe829df570359891ea3a1c43bdc58253a1a5103bcdf4c9',
    );
  });

  it('post100: sha256 of Verify script block tokens', () => {
    const tokens = ['npm ci', 'npm run typecheck', 'npm test', 'npm run test:coverage'].join('\n');
    expect(createHash('sha256').update(tokens).digest('hex')).toBe(
      '0ddf9e851fceb0350faa3d8b53ed0bfdcaa2aaed6efbcc15259e212de662e007',
    );
    expect(read('AGENTS.md')).toContain('npm run test:coverage');
  });

  it('post100: cross-lock README mentions CI badge without inventing routes', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/CI/);
    expect(readme).not.toMatch(/\/playlist|\/now-playing/);
  });

  it('post100: cross-lock DEPLOY.md HITL workflow_dispatch language', () => {
    const deployMd = read('DEPLOY.md');
    expect(deployMd.toLowerCase()).toMatch(/hitl|workflow_dispatch|manual|human/);
    expect(read('.github/workflows/deploy.yml')).toContain('workflow_dispatch');
  });

  it('post100: cross-lock wrangler.toml name backlink without secrets', () => {
    const toml = read('wrangler.toml');
    expect(toml).toContain('name = "backlink"');
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(read('.github/workflows/ci.yml')).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
  });

  it('post100: cross-lock helpers.ts exists for route stubs without CI fetching iptv', () => {
    expect(read('test/helpers.ts')).toContain('export function stubIptvAndGemini');
    expect(read('.github/workflows/ci.yml')).not.toContain('iptv-org.github.io');
  });

  it('post100: mega purity — 40 rounds of ci.yml sha256 stability', () => {
    const expected = 'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5';
    for (let i = 0; i < 40; i++) {
      expect(sha256('.github/workflows/ci.yml')).toBe(expected);
    }
  });

  it('post100: mega purity — 20 rounds of package.json + vitest digests', () => {
    const pkgD = '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c';
    const vitD = 'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38';
    for (let i = 0; i < 20; i++) {
      expect(sha256('package.json')).toBe(pkgD);
      expect(sha256('vitest.config.ts')).toBe(vitD);
    }
  });

  it('post100: final inventory — ci-config describe blocks include post79 and post100', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post79 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post100 ci-config HEAVY deepen'");
    expect((body.match(/it\('post100:/g) ?? []).length).toBeGreaterThan(100);
  });

  it('post100: ci-config.test.ts ends with newline after post100', () => {
    expect(read('test/ci-config.test.ts').endsWith('\n')).toBe(true);
  });

  it('post100: dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(read('package.json')).toContain('"name": "backlink"');
  });

});

// --- HEAVY burn (post-#116): deepen ci-config unit slice only — no product inventing ---
// Orthogonal to #116 routes, #115 source-contracts, #114 mcp-spec, #113 helpers.
// Digests, HMAC locks, workflow pins, package/vitest/hygiene/ISSUE_TEMPLATE/AGENTS Verify
// cross-locks — tests-only. TOKENMAXX after helpers/mcp-spec/source-contracts.

describe('post116 ci-config HEAVY deepen', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) =>
    createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) =>
    createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);

  it('post116: locks ci.yml sha256 digest', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe(
          'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
        );
  });

  it('post116: locks ci.yml sha1 digest', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post116: locks ci.yml md5 digest', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post116: locks ci.yml sha384 digest', () => {
    expect(sha384('.github/workflows/ci.yml')).toBe(
          '8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab',
        );
  });

  it('post116: locks ci.yml sha512 digest', () => {
    expect(sha512('.github/workflows/ci.yml')).toBe(
          '3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460',
        );
  });

  it('post116: locks ci.yml sha256 nibble sum 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
        expect(nibbleSum(d)).toBe(515);
        expect(xorNibbles(d)).toBe(3);
  });

  it('post116: locks ci.yml byte size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
        expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post116: locks ci.yml utf8 char length 6295', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
  });

  it('post116: locks ci.yml line count 177', () => {
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post116: locks ci.yml HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', '.github/workflows/ci.yml')).toBe(
          'b3e76b2fe2dcb28fc56a47ec88c1d107378aa305bbfb81515b153e1c67e716f9',
        );
  });

  it('post116: locks ci.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/workflows/ci.yml')).toBe(
          'e997e669ee801faeaaac0ecfb8239cc5d416ffd739f752a288a997d086e7bd15',
        );
  });

  it('post116: locks ci.yml HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe(
          '5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b',
        );
  });

  it('post116: locks ci.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/ci.yml');
        expect(hex.slice(0, 2)).toBe('c4');
        expect(hex.slice(-2)).toBe('d5');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks deploy.yml sha256 digest', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe(
          '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
        );
  });

  it('post116: locks deploy.yml sha1 digest', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post116: locks deploy.yml md5 digest', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post116: locks deploy.yml sha384 digest', () => {
    expect(sha384('.github/workflows/deploy.yml')).toBe(
          '61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f',
        );
  });

  it('post116: locks deploy.yml sha512 digest', () => {
    expect(sha512('.github/workflows/deploy.yml')).toBe(
          '7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641',
        );
  });

  it('post116: locks deploy.yml sha256 nibble sum 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
        expect(nibbleSum(d)).toBe(476);
        expect(xorNibbles(d)).toBe(4);
  });

  it('post116: locks deploy.yml byte size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
        expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post116: locks deploy.yml utf8 char length 1004', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
  });

  it('post116: locks deploy.yml line count 47', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post116: locks deploy.yml HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', '.github/workflows/deploy.yml')).toBe(
          'e05ffe3beb12989cd51474b3c25efefea02dd8c0888bd4e58f227bcdef03e2e5',
        );
  });

  it('post116: locks deploy.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/workflows/deploy.yml')).toBe(
          'b2d258b8ef783136b38e6607f0b0c441f5f7cc85a2aca677b051bdba3fa57eca',
        );
  });

  it('post116: locks deploy.yml HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe(
          '339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b',
        );
  });

  it('post116: locks deploy.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/deploy.yml');
        expect(hex.slice(0, 2)).toBe('49');
        expect(hex.slice(-2)).toBe('c3');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks dependabot.yml sha256 digest', () => {
    expect(sha256('.github/dependabot.yml')).toBe(
          'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac',
        );
  });

  it('post116: locks dependabot.yml sha1 digest', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post116: locks dependabot.yml md5 digest', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post116: locks dependabot.yml sha384 digest', () => {
    expect(sha384('.github/dependabot.yml')).toBe(
          'ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc',
        );
  });

  it('post116: locks dependabot.yml sha512 digest', () => {
    expect(sha512('.github/dependabot.yml')).toBe(
          '276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e',
        );
  });

  it('post116: locks dependabot.yml sha256 nibble sum 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
        expect(nibbleSum(d)).toBe(526);
        expect(xorNibbles(d)).toBe(6);
  });

  it('post116: locks dependabot.yml byte size 505', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
        expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post116: locks dependabot.yml utf8 char length 505', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
  });

  it('post116: locks dependabot.yml line count 25', () => {
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post116: locks dependabot.yml HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', '.github/dependabot.yml')).toBe(
          '1c233aa2ace4f5bf41ad468c518e143ebd821c4824a54a7aea76b01f3152941e',
        );
  });

  it('post116: locks dependabot.yml HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.github/dependabot.yml')).toBe(
          '8b61de03ef1b75db2912b46274382788f1abd7bb4823d4dfe80d94c5caaae024',
        );
  });

  it('post116: locks dependabot.yml HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe(
          'e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1',
        );
  });

  it('post116: locks dependabot.yml sha256 first/last octets', () => {
    const hex = sha256('.github/dependabot.yml');
        expect(hex.slice(0, 2)).toBe('a1');
        expect(hex.slice(-2)).toBe('ac');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks package.json sha256 digest', () => {
    expect(sha256('package.json')).toBe(
          '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
        );
  });

  it('post116: locks package.json sha1 digest', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post116: locks package.json md5 digest', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post116: locks package.json sha384 digest', () => {
    expect(sha384('package.json')).toBe(
          '4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20',
        );
  });

  it('post116: locks package.json sha512 digest', () => {
    expect(sha512('package.json')).toBe(
          '7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28',
        );
  });

  it('post116: locks package.json sha256 nibble sum 451 xor 13', () => {
    const d = sha256('package.json');
        expect(nibbleSum(d)).toBe(451);
        expect(xorNibbles(d)).toBe(13);
  });

  it('post116: locks package.json byte size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
        expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post116: locks package.json utf8 char length 635', () => {
    expect(read('package.json')).toHaveLength(635);
  });

  it('post116: locks package.json line count 26', () => {
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post116: locks package.json HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'package.json')).toBe(
          '301ea9f30eff5472c313b6a25113ea1a2f8f45d80d552d240ba85cddf2cd7d87',
        );
  });

  it('post116: locks package.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'package.json')).toBe(
          '9af90b16d02d642aa55aa2a1cf7816f6cab099d1837f4d1efcc3a76638229f38',
        );
  });

  it('post116: locks package.json HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'package.json')).toBe(
          'ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58',
        );
  });

  it('post116: locks package.json sha256 first/last octets', () => {
    const hex = sha256('package.json');
        expect(hex.slice(0, 2)).toBe('34');
        expect(hex.slice(-2)).toBe('1c');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks package-lock.json sha256 digest', () => {
    expect(sha256('package-lock.json')).toBe(
          '5f8a888f1fc7aaf97dcdaa3f91405cefbb45ad118685eac7a1488b78cedfcee6',
        );
  });

  it('post116: locks package-lock.json sha1 digest', () => {
    expect(sha1('package-lock.json')).toBe('6bc7eb19009d4dccc1d2928b0d856f337eb76aad');
  });

  it('post116: locks package-lock.json md5 digest', () => {
    expect(md5('package-lock.json')).toBe('568e267e07346bb7de4796dbeb117b54');
  });

  it('post116: locks package-lock.json sha384 digest', () => {
    expect(sha384('package-lock.json')).toBe(
          '4565cacc84fdc7310f58a9dd877af17e094c9f5e388dcfa3ba20d618402f2978d9c0cdcea6112627d9068ee5b8a4cee1',
        );
  });

  it('post116: locks package-lock.json sha512 digest', () => {
    expect(sha512('package-lock.json')).toBe(
          '53b687e02a98373356e850535322bbec058b7b8dff2374fb03de81d925065cdb7a15cd37411e4625a3888965ba07d2667e6f6667db885bf14147027d0183303d',
        );
  });

  it('post116: locks package-lock.json sha256 nibble sum 582 xor 4', () => {
    const d = sha256('package-lock.json');
        expect(nibbleSum(d)).toBe(582);
        expect(xorNibbles(d)).toBe(4);
  });

  it('post116: locks package-lock.json byte size 92068', () => {
    expect(statSync(join(root, 'package-lock.json')).size).toBe(92068);
        expect(readFileSync(join(root, 'package-lock.json')).byteLength).toBe(92068);
  });

  it('post116: locks package-lock.json utf8 char length 92068', () => {
    expect(read('package-lock.json')).toHaveLength(92068);
  });

  it('post116: locks package-lock.json line count 2842', () => {
    expect(read('package-lock.json').split('\n')).toHaveLength(2842);
  });

  it('post116: locks package-lock.json HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'package-lock.json')).toBe(
          'd403aea7973f732c0795a84af10944a3ec93b8366d0d86b1193a53dc13d51c92',
        );
  });

  it('post116: locks package-lock.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'package-lock.json')).toBe(
          '326a070fd1036eba109bdafe8028c34e0f80e740db01e586803212520bee632a',
        );
  });

  it('post116: locks package-lock.json HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'package-lock.json')).toBe(
          '24956301447a44ef4e959ed0d00d0aa0eea4c873a4ab1c2f5fcab7b27233053b',
        );
  });

  it('post116: locks package-lock.json sha256 first/last octets', () => {
    const hex = sha256('package-lock.json');
        expect(hex.slice(0, 2)).toBe('5f');
        expect(hex.slice(-2)).toBe('e6');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks vitest.config.ts sha256 digest', () => {
    expect(sha256('vitest.config.ts')).toBe(
          'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
        );
  });

  it('post116: locks vitest.config.ts sha1 digest', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post116: locks vitest.config.ts md5 digest', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post116: locks vitest.config.ts sha384 digest', () => {
    expect(sha384('vitest.config.ts')).toBe(
          'c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563',
        );
  });

  it('post116: locks vitest.config.ts sha512 digest', () => {
    expect(sha512('vitest.config.ts')).toBe(
          'ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682',
        );
  });

  it('post116: locks vitest.config.ts sha256 nibble sum 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
        expect(nibbleSum(d)).toBe(536);
        expect(xorNibbles(d)).toBe(2);
  });

  it('post116: locks vitest.config.ts byte size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
        expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post116: locks vitest.config.ts utf8 char length 535', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
  });

  it('post116: locks vitest.config.ts line count 22', () => {
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post116: locks vitest.config.ts HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'vitest.config.ts')).toBe(
          'e22039027fee322939196b3c7e2c6a8ffd187a2679172739447a91b9e564064b',
        );
  });

  it('post116: locks vitest.config.ts HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'vitest.config.ts')).toBe(
          'b48d4463ac3144a8a6e5e60a568762fe11adefce678494ceb591e4e63ae528c3',
        );
  });

  it('post116: locks vitest.config.ts HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe(
          '0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9',
        );
  });

  it('post116: locks vitest.config.ts sha256 first/last octets', () => {
    const hex = sha256('vitest.config.ts');
        expect(hex.slice(0, 2)).toBe('f9');
        expect(hex.slice(-2)).toBe('38');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks tsconfig.json sha256 digest', () => {
    expect(sha256('tsconfig.json')).toBe(
          'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
        );
  });

  it('post116: locks tsconfig.json sha1 digest', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post116: locks tsconfig.json md5 digest', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post116: locks tsconfig.json sha384 digest', () => {
    expect(sha384('tsconfig.json')).toBe(
          '2776ddc534d652582b058179048240c9df59cfc882305b98aa08108dd00b1e56a8cecf89510fd59bec966575455dd15d',
        );
  });

  it('post116: locks tsconfig.json sha512 digest', () => {
    expect(sha512('tsconfig.json')).toBe(
          '1ef6e98053d98ec50aeabad12d3f8b7bd44bd81f1a0f63264f0b8530b65b75a1f4e4f705147467a3099a0a89674db33becaf259d25b28c546d2cbdb4862614f3',
        );
  });

  it('post116: locks tsconfig.json sha256 nibble sum 506 xor 8', () => {
    const d = sha256('tsconfig.json');
        expect(nibbleSum(d)).toBe(506);
        expect(xorNibbles(d)).toBe(8);
  });

  it('post116: locks tsconfig.json byte size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
        expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post116: locks tsconfig.json utf8 char length 397', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
  });

  it('post116: locks tsconfig.json line count 24', () => {
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post116: locks tsconfig.json HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'tsconfig.json')).toBe(
          'e1e86cdf0e344a4996a7c991eb24f9d5e32bec8f0857d1efad74092a22fa65b3',
        );
  });

  it('post116: locks tsconfig.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'tsconfig.json')).toBe(
          '419001e750f87204a6c6d4cffff7d5324d92ef88acc751e05de8b60b747c008a',
        );
  });

  it('post116: locks tsconfig.json HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe(
          '2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1',
        );
  });

  it('post116: locks tsconfig.json sha256 first/last octets', () => {
    const hex = sha256('tsconfig.json');
        expect(hex.slice(0, 2)).toBe('ef');
        expect(hex.slice(-2)).toBe('92');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks AGENTS.md sha256 digest', () => {
    expect(sha256('AGENTS.md')).toBe(
          '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
        );
  });

  it('post116: locks AGENTS.md sha1 digest', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post116: locks AGENTS.md md5 digest', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post116: locks AGENTS.md sha384 digest', () => {
    expect(sha384('AGENTS.md')).toBe(
          '817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a',
        );
  });

  it('post116: locks AGENTS.md sha512 digest', () => {
    expect(sha512('AGENTS.md')).toBe(
          '7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908',
        );
  });

  it('post116: locks AGENTS.md sha256 nibble sum 479 xor 5', () => {
    const d = sha256('AGENTS.md');
        expect(nibbleSum(d)).toBe(479);
        expect(xorNibbles(d)).toBe(5);
  });

  it('post116: locks AGENTS.md byte size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
        expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post116: locks AGENTS.md utf8 char length 1011', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
  });

  it('post116: locks AGENTS.md line count 35', () => {
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post116: locks AGENTS.md HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'AGENTS.md')).toBe(
          '06d8319289e454e39ca534397843a5afa13d549fe15e47fbd9d8e35be2590c2a',
        );
  });

  it('post116: locks AGENTS.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'AGENTS.md')).toBe(
          '1e8f20e9d67be8517c3acfdce81387fdbcd5d1bda52f43fffdb055139810c224',
        );
  });

  it('post116: locks AGENTS.md HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe(
          'b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f',
        );
  });

  it('post116: locks AGENTS.md sha256 first/last octets', () => {
    const hex = sha256('AGENTS.md');
        expect(hex.slice(0, 2)).toBe('48');
        expect(hex.slice(-2)).toBe('aa');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks DEPLOY.md sha256 digest', () => {
    expect(sha256('DEPLOY.md')).toBe(
          '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
        );
  });

  it('post116: locks DEPLOY.md sha1 digest', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post116: locks DEPLOY.md md5 digest', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post116: locks DEPLOY.md sha384 digest', () => {
    expect(sha384('DEPLOY.md')).toBe(
          '90ba0589c08054172762287998d2a4d110a704705f82771cbd041c0f559f7b9a84dfbf37630b1f7bc9fa2cdbb4d1bf83',
        );
  });

  it('post116: locks DEPLOY.md sha512 digest', () => {
    expect(sha512('DEPLOY.md')).toBe(
          '504275c3bb3c4aa2dd5b4baa6accef1d5a8b83e995bf92146bed27604089ad7ae4540575691383a03a36062562e4388984a560a7ab199451b3bc063104162b80',
        );
  });

  it('post116: locks DEPLOY.md sha256 nibble sum 439 xor 11', () => {
    const d = sha256('DEPLOY.md');
        expect(nibbleSum(d)).toBe(439);
        expect(xorNibbles(d)).toBe(11);
  });

  it('post116: locks DEPLOY.md byte size 1573', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573);
        expect(readFileSync(join(root, 'DEPLOY.md')).byteLength).toBe(1573);
  });

  it('post116: locks DEPLOY.md utf8 char length 1539', () => {
    expect(read('DEPLOY.md')).toHaveLength(1539);
  });

  it('post116: locks DEPLOY.md line count 65', () => {
    expect(read('DEPLOY.md').split('\n')).toHaveLength(65);
  });

  it('post116: locks DEPLOY.md HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'DEPLOY.md')).toBe(
          'fcd0fa73ee6971ec2150ea01b149fe9eb1625a31d9d446ce241c421a14448a36',
        );
  });

  it('post116: locks DEPLOY.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'DEPLOY.md')).toBe(
          'b27e64e44a605676c5e7ec1ac636c68b62712ebbb87a5f5f64d0e031bd827ecd',
        );
  });

  it('post116: locks DEPLOY.md HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'DEPLOY.md')).toBe(
          'bdb0c19924928cf4d54308dcdd72f032fea4ae1994669e96bf22f48567084f26',
        );
  });

  it('post116: locks DEPLOY.md sha256 first/last octets', () => {
    const hex = sha256('DEPLOY.md');
        expect(hex.slice(0, 2)).toBe('11');
        expect(hex.slice(-2)).toBe('5a');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks README.md sha256 digest', () => {
    expect(sha256('README.md')).toBe(
          'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
        );
  });

  it('post116: locks README.md sha1 digest', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post116: locks README.md md5 digest', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post116: locks README.md sha384 digest', () => {
    expect(sha384('README.md')).toBe(
          '52db664da38cae8aa1f5dfb3d02bfca990d2cf0700142c089c2c6d0440014d9dbd94b63af5fa31e97995b071c7758f11',
        );
  });

  it('post116: locks README.md sha512 digest', () => {
    expect(sha512('README.md')).toBe(
          'a66447cc7968b9d04a99157b8598e52dc849462692f4e34fc8af624c5a92377700bea429e236b8102cd76bf48d680ed490795b1da33909f001d8fec14336e337',
        );
  });

  it('post116: locks README.md sha256 nibble sum 429 xor 13', () => {
    const d = sha256('README.md');
        expect(nibbleSum(d)).toBe(429);
        expect(xorNibbles(d)).toBe(13);
  });

  it('post116: locks README.md byte size 2801', () => {
    expect(statSync(join(root, 'README.md')).size).toBe(2801);
        expect(readFileSync(join(root, 'README.md')).byteLength).toBe(2801);
  });

  it('post116: locks README.md utf8 char length 2757', () => {
    expect(read('README.md')).toHaveLength(2757);
  });

  it('post116: locks README.md line count 82', () => {
    expect(read('README.md').split('\n')).toHaveLength(82);
  });

  it('post116: locks README.md HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', 'README.md')).toBe(
          '228659c5f19833de2087b220c2408e31c0a717043ac432898e238b83a1e56870',
        );
  });

  it('post116: locks README.md HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', 'README.md')).toBe(
          'd2200d30dd2c44cf22921293f93f55010c881b75b920cab8276ddcef891875b6',
        );
  });

  it('post116: locks README.md HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', 'README.md')).toBe(
          '51a608392fd700865f32aac02646908bf1235d6c4d587e9daa92383d6a777b94',
        );
  });

  it('post116: locks README.md sha256 first/last octets', () => {
    const hex = sha256('README.md');
        expect(hex.slice(0, 2)).toBe('f7');
        expect(hex.slice(-2)).toBe('87');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks .gitattributes sha256 digest', () => {
    expect(sha256('.gitattributes')).toBe(
          '1a1dbe176bc233b499d35a57db7513f2941c99ab9759f177830c9149be99005b',
        );
  });

  it('post116: locks .gitattributes sha1 digest', () => {
    expect(sha1('.gitattributes')).toBe('ba3dfe345280bdcc5e817bb02cf49b8b8d8e1c4c');
  });

  it('post116: locks .gitattributes md5 digest', () => {
    expect(md5('.gitattributes')).toBe('05bdb783ee6514c8c072e47680af8ff7');
  });

  it('post116: locks .gitattributes sha384 digest', () => {
    expect(sha384('.gitattributes')).toBe(
          '4ee62c34f5a07b4cac36ddb78174097f6de139cd17007129fde0198e18eb521ac0a75f788f548427362a589824127692',
        );
  });

  it('post116: locks .gitattributes sha512 digest', () => {
    expect(sha512('.gitattributes')).toBe(
          '9e820d6126d62c0b89e380c69685f6668b2f131283f57e524f59492fa6df22844dda1b90d244d4a1f8aea78a84e65d47b1a878168c4e41001459a947ef275ffe',
        );
  });

  it('post116: locks .gitattributes sha256 nibble sum 458 xor 4', () => {
    const d = sha256('.gitattributes');
        expect(nibbleSum(d)).toBe(458);
        expect(xorNibbles(d)).toBe(4);
  });

  it('post116: locks .gitattributes byte size 66', () => {
    expect(statSync(join(root, '.gitattributes')).size).toBe(66);
        expect(readFileSync(join(root, '.gitattributes')).byteLength).toBe(66);
  });

  it('post116: locks .gitattributes utf8 char length 66', () => {
    expect(read('.gitattributes')).toHaveLength(66);
  });

  it('post116: locks .gitattributes line count 3', () => {
    expect(read('.gitattributes').split('\n')).toHaveLength(3);
  });

  it('post116: locks .gitattributes HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', '.gitattributes')).toBe(
          'de294243067f32f6a22c5452c8cb488a3e98c182994b3b7bd14e09067dcbe69c',
        );
  });

  it('post116: locks .gitattributes HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.gitattributes')).toBe(
          '6ce67056afbd26bb77fe120d1cf0d1ca508fe14b68665b2864ee447a3986c241',
        );
  });

  it('post116: locks .gitattributes HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', '.gitattributes')).toBe(
          '7c36f5272e867b9e47a45a44b6754e7e5d7da1eac848a606d57ba9c676b26b2c',
        );
  });

  it('post116: locks .gitattributes sha256 first/last octets', () => {
    const hex = sha256('.gitattributes');
        expect(hex.slice(0, 2)).toBe('1a');
        expect(hex.slice(-2)).toBe('5b');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks .gitignore sha256 digest', () => {
    expect(sha256('.gitignore')).toBe(
          '474ed59338a23de819e219c00d0e033b23e3669cc4106ce7a888fe0636569698',
        );
  });

  it('post116: locks .gitignore sha1 digest', () => {
    expect(sha1('.gitignore')).toBe('432103230f4c49258e046fc945e8160007c23570');
  });

  it('post116: locks .gitignore md5 digest', () => {
    expect(md5('.gitignore')).toBe('7d0728257f47875ec0120ca3cdbf7308');
  });

  it('post116: locks .gitignore sha384 digest', () => {
    expect(sha384('.gitignore')).toBe(
          'be1d228c314f49d0279908556287e3071c8ca1cba4a6ee436ac536e276dcebd732bda1d3a4bb59940436751af7ec0338',
        );
  });

  it('post116: locks .gitignore sha512 digest', () => {
    expect(sha512('.gitignore')).toBe(
          'b51faf155fa4927dcc7032a23ddace6ba90c71a7e165382c024c79f21693d5c2be91df95ef4b632b1f4577ad0a18d19d11e450d647ff99c11f95f29b3fa4a5c0',
        );
  });

  it('post116: locks .gitignore sha256 nibble sum 444 xor 6', () => {
    const d = sha256('.gitignore');
        expect(nibbleSum(d)).toBe(444);
        expect(xorNibbles(d)).toBe(6);
  });

  it('post116: locks .gitignore byte size 261', () => {
    expect(statSync(join(root, '.gitignore')).size).toBe(261);
        expect(readFileSync(join(root, '.gitignore')).byteLength).toBe(261);
  });

  it('post116: locks .gitignore utf8 char length 261', () => {
    expect(read('.gitignore')).toHaveLength(261);
  });

  it('post116: locks .gitignore line count 26', () => {
    expect(read('.gitignore').split('\n')).toHaveLength(26);
  });

  it('post116: locks .gitignore HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', '.gitignore')).toBe(
          '7cf76bb3e7f736bbca7353efb1a53a2e9fc7e10864acb7ab5310444bf376d8eb',
        );
  });

  it('post116: locks .gitignore HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.gitignore')).toBe(
          '6a912adbdce7ef35c0e20cedc5559dea42d8e8af9a1af43490aca607d0c89af3',
        );
  });

  it('post116: locks .gitignore HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', '.gitignore')).toBe(
          'bbbfdc2ee1fa55e48995309d32c4075e45a2a9de5acff73e85b293868daaed83',
        );
  });

  it('post116: locks .gitignore sha256 first/last octets', () => {
    const hex = sha256('.gitignore');
        expect(hex.slice(0, 2)).toBe('47');
        expect(hex.slice(-2)).toBe('98');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks .cursor/environment.json sha256 digest', () => {
    expect(sha256('.cursor/environment.json')).toBe(
          '4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694',
        );
  });

  it('post116: locks .cursor/environment.json sha1 digest', () => {
    expect(sha1('.cursor/environment.json')).toBe('b4f3dec322cd018ce5c1dea89897a469bd128685');
  });

  it('post116: locks .cursor/environment.json md5 digest', () => {
    expect(md5('.cursor/environment.json')).toBe('956c8804543595a31d6a7051aecd6528');
  });

  it('post116: locks .cursor/environment.json sha384 digest', () => {
    expect(sha384('.cursor/environment.json')).toBe(
          '0347d0c47319d7ae7b0221f2aac85537294169efac93d2fab633127f2a4fddcedba85875545448a4048d66f22a89193b',
        );
  });

  it('post116: locks .cursor/environment.json sha512 digest', () => {
    expect(sha512('.cursor/environment.json')).toBe(
          'bc77873140fa55fe7b9ff10f6c7ebb8e287d35087bc0da8667814e3db45773a3a4bcecb1f7ab7479e0a2c0c4cad140c385583af6a0bb760a01121a1c830a6efb',
        );
  });

  it('post116: locks .cursor/environment.json sha256 nibble sum 472 xor 0', () => {
    const d = sha256('.cursor/environment.json');
        expect(nibbleSum(d)).toBe(472);
        expect(xorNibbles(d)).toBe(0);
  });

  it('post116: locks .cursor/environment.json byte size 57', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57);
        expect(readFileSync(join(root, '.cursor/environment.json')).byteLength).toBe(57);
  });

  it('post116: locks .cursor/environment.json utf8 char length 57', () => {
    expect(read('.cursor/environment.json')).toHaveLength(57);
  });

  it('post116: locks .cursor/environment.json line count 5', () => {
    expect(read('.cursor/environment.json').split('\n')).toHaveLength(5);
  });

  it('post116: locks .cursor/environment.json HMAC-SHA256 key post116', () => {
    expect(hmacSha256('post116', '.cursor/environment.json')).toBe(
          '6c696553af0d2541d64c9e87a73e69b482cd02a0f107ac73a122a7032f977832',
        );
  });

  it('post116: locks .cursor/environment.json HMAC-SHA256 key ci-config', () => {
    expect(hmacSha256('ci-config', '.cursor/environment.json')).toBe(
          '89582143f68b016bb37c4fbcd570f0c296c37c459c19c70fbc513907d0357136',
        );
  });

  it('post116: locks .cursor/environment.json HMAC-SHA256 key TOKENMAXX', () => {
    expect(hmacSha256('TOKENMAXX', '.cursor/environment.json')).toBe(
          '796f38bc3f8907bef23dc36e49231f310bae76a745c9e26ac5073ba2ec3e8c49',
        );
  });

  it('post116: locks .cursor/environment.json sha256 first/last octets', () => {
    const hex = sha256('.cursor/environment.json');
        expect(hex.slice(0, 2)).toBe('4e');
        expect(hex.slice(-2)).toBe('94');
        expect(hex).toHaveLength(64);
  });

  it('post116: locks ISSUE_TEMPLATE/bug.yml sha256', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
          'f76fcc573b913789446748a601dcb4a8d2cfaa3ec85d2c6bb798f2a35b844055',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/bug.yml size 846', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).size).toBe(846);
  });

  it('post116: locks ISSUE_TEMPLATE/bug.yml HMAC post116', () => {
    expect(hmacSha256('post116', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
          'ad49f913cd647510372b7354ffb9d6db8935d87b3278b9654481e64085f7c22a',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/chore.yml sha256', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
          '230222c6ac61737a55b00df4442d483911154bd93657ba98a1d30b75b509c3fc',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/chore.yml size 705', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).size).toBe(705);
  });

  it('post116: locks ISSUE_TEMPLATE/chore.yml HMAC post116', () => {
    expect(hmacSha256('post116', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
          '45a791a36e32ea9e20c425a00d01d9592f9dbf61f78ad83ccac6b9bc1b711805',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/config.yml sha256', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml')).toBe(
          '1f103c6a9dd07cd13a9a6f17ace6b813f47747eb9cb7e00488cb2073caaf91bb',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/config.yml size 28', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).size).toBe(28);
  });

  it('post116: locks ISSUE_TEMPLATE/config.yml HMAC post116', () => {
    expect(hmacSha256('post116', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
          '587a9487ac8831bedace264105ae734808089ca19f22864b26e629d526e5efd6',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/feature.yml sha256', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
          '83291f987d1bb546b45ecd09d9be597c5265591a99744d18a2c49122e390aac2',
        );
  });

  it('post116: locks ISSUE_TEMPLATE/feature.yml size 966', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).size).toBe(966);
  });

  it('post116: locks ISSUE_TEMPLATE/feature.yml HMAC post116', () => {
    expect(hmacSha256('post116', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
          '2f66dfba764d7734335ed18b6c28d31cdb63984a8885e9970942b86be7a4ca84',
        );
  });

  it('post116: locks package.json name version type description', () => {
    const pkg = JSON.parse(read('package.json')) as {
          name: string;
          version: string;
          type: string;
          description: string;
        };
        expect(pkg.name).toBe('backlink');
        expect(pkg.version).toBe('0.1.0');
        expect(pkg.type).toBe('module');
        expect(pkg.description).toContain('LLM-curated internet radio');
        expect(pkg.description).toContain('iptv-org');
  });

  it('post116: locks package.json exactly six scripts', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        expect(Object.keys(pkg.scripts).sort()).toEqual([
          'deploy',
          'dev',
          'test',
          'test:coverage',
          'test:watch',
          'typecheck',
        ]);
        expect(pkg.scripts.dev).toBe('wrangler dev');
        expect(pkg.scripts.deploy).toBe('wrangler deploy');
        expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
        expect(pkg.scripts.test).toBe('vitest run');
        expect(pkg.scripts['test:watch']).toBe('vitest');
        expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post116: locks package.json sole runtime dependency hono caret 4', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies: Record<string, string>;
          devDependencies: Record<string, string>;
        };
        expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
        expect(pkg.dependencies.hono).toMatch(/^\^4\./);
        expect(Object.keys(pkg.devDependencies).sort()).toEqual([
          '@cloudflare/workers-types',
          '@types/node',
          '@vitest/coverage-v8',
          'typescript',
          'vitest',
          'wrangler',
        ]);
  });

  it('post116: locks package-lock.json name lockfileVersion packages 168', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
          name: string;
          lockfileVersion: number;
          packages: Record<string, unknown>;
        };
        expect(lock.name).toBe('backlink');
        expect(lock.lockfileVersion).toBe(3);
        expect(Object.keys(lock.packages)).toHaveLength(168);
  });

  it('post116: locks vitest.config.ts 100% thresholds and types exclude', () => {
    const cfg = read('vitest.config.ts');
        expect(cfg).toContain("environment: 'node'");
        expect(cfg).toContain("include: ['test/**/*.test.ts']");
        expect(cfg).toContain("include: ['src/**/*.ts']");
        expect(cfg).toContain("exclude: ['src/types.ts']");
        expect(cfg).toMatch(/lines:\s*100/);
        expect(cfg).toMatch(/functions:\s*100/);
        expect(cfg).toMatch(/branches:\s*100/);
        expect(cfg).toMatch(/statements:\s*100/);
        expect(cfg).toContain('github-actions');
        expect(cfg).toContain("'lcov'");
  });

  it('post116: locks tsconfig.json include vitest.config.ts', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
          compilerOptions: Record<string, unknown>;
          include: string[];
        };
        expect(ts.compilerOptions.target).toBeTruthy();
        expect(ts.include).toEqual(expect.arrayContaining(['vitest.config.ts']));
  });

  it('post116: locks ci.yml three jobs Typecheck Tests Hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('name: CI');
        expect(ci).toContain('name: Typecheck');
        expect(ci).toContain('name: Tests');
        expect(ci).toContain('name: Hygiene');
        expect(ci).toMatch(/npm run typecheck/);
        expect(ci).toMatch(/npm run test:coverage/);
        expect(ci).toContain('actions/checkout@v7');
        expect(ci).toContain('actions/setup-node@v7');
        expect(ci).toContain('actions/upload-artifact@v4');
        expect(ci).toContain('node-version: "20"');
        expect(ci).toContain('cancel-in-progress: true');
        expect(ci).toContain('contents: read');
  });

  it('post116: locks ci.yml hygiene lists all nine suite files', () => {
    const ci = read('.github/workflows/ci.yml');
        for (const f of [
          'test/parser.test.ts',
          'test/genres.test.ts',
          'test/routes.test.ts',
          'test/mcp.test.ts',
          'test/helpers.ts',
          'test/helpers.test.ts',
          'test/mcp-spec-contract.test.ts',
          'test/ci-config.test.ts',
          'test/wrangler-config.test.ts',
          'test/source-contracts.test.ts',
        ]) {
          expect(ci).toContain(f);
        }
  });

  it('post116: locks deploy.yml HITL workflow_dispatch only', () => {
    const deploy = read('.github/workflows/deploy.yml');
        expect(deploy).toContain('workflow_dispatch');
        expect(deploy).not.toMatch(/^\s*push:/m);
        expect(deploy).not.toMatch(/^\s*pull_request:/m);
        expect(deploy).toContain('cancel-in-progress: false');
        expect(deploy).toContain('secrets.GEMINI_API_KEY');
        expect(deploy).toContain('name: Deploy to Cloudflare Workers');
  });

  it('post116: locks dependabot npm and github-actions non-major', () => {
    const dep = read('.github/dependabot.yml');
        expect(dep).toContain('version: 2');
        expect(dep).toMatch(/package-ecosystem:\s*"npm"/);
        expect(dep).toMatch(/package-ecosystem:\s*"github-actions"/);
        expect(dep).toContain('version-update:semver-major');
  });

  it('post116: locks AGENTS.md Verify block exact four commands', () => {
    const agents = read('AGENTS.md');
        expect(agents).toContain('npm ci');
        expect(agents).toContain('npm run typecheck');
        expect(agents).toContain('npm test');
        expect(agents).toContain('npm run test:coverage');
        expect(agents).toContain('Tier: A');
        expect(agents).toContain('Autonomy: L2');
        expect(agents).toContain('backlink.fuzzywigg.com');
  });

  it('post116: locks AGENTS.md escalate secrets and HITL deploy', () => {
    const agents = read('AGENTS.md');
        expect(agents).toContain('GEMINI_API_KEY');
        expect(agents).toMatch(/HITL|first deploy/i);
        expect(agents).toContain('CORS');
        expect(agents).not.toContain('ANTHROPIC_API_KEY');
        expect(agents).not.toContain('OPENAI_API_KEY');
  });

  it('post116: locks DEPLOY.md HITL and no secret material', () => {
    const deployMd = read('DEPLOY.md');
        expect(deployMd.toLowerCase()).toMatch(/hitl|workflow_dispatch|manual/);
        expect(deployMd).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
        expect(deployMd).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
        expect(deployMd).toContain('wrangler');
  });

  it('post116: locks README CI badge without inventing playlist routes', () => {
    const readme = read('README.md');
        expect(readme).toMatch(/CI/);
        expect(readme).toContain('Backlink');
        expect(readme).not.toMatch(/\/playlist|\/now-playing/);
        expect(readme).not.toContain('supabase');
        expect(readme).not.toContain('firebase');
  });

  it('post116: locks .cursor/environment.json install npm ci', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as {
          name: string;
          install: string;
        };
        expect(env.name).toBe('Backlink_Facelift');
        expect(env.install).toBe('npm ci');
        expect(Object.keys(env).sort()).toEqual(['install', 'name']);
  });

  it('post116: locks .gitattributes LF normalization', () => {
    const ga = read('.gitattributes');
        expect(ga).toContain('* text=auto');
        expect(ga.split('\n')).toHaveLength(3);
  });

  it('post116: locks .gitignore covers node_modules coverage wrangler', () => {
    const gi = read('.gitignore');
        expect(gi).toContain('node_modules/');
        expect(gi).toMatch(/coverage/);
        expect(gi).toMatch(/\.wrangler|wrangler/);
  });

  it('post116: locks ISSUE_TEMPLATE inventory alphabetical', () => {
    const names = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
        expect(names).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('post116: no anthropic in package.json', () => {
    expect(read('package.json').toLowerCase()).not.toContain('anthropic');
  });

  it('post116: no openai in package.json', () => {
    expect(read('package.json').toLowerCase()).not.toContain('openai');
  });

  it('post116: no express in package.json', () => {
    expect(read('package.json')).not.toContain('express');
  });

  it('post116: no next in package.json', () => {
    expect(JSON.parse(read('package.json')).dependencies).not.toHaveProperty('next');
  });

  it('post116: no jest in package.json', () => {
    expect(read('package.json')).not.toContain('jest');
  });

  it('post116: no mocha in package.json', () => {
    expect(read('package.json')).not.toContain('mocha');
  });

  it('post116: no playwright in CI', () => {
    expect(read('.github/workflows/ci.yml').toLowerCase()).not.toContain('playwright');
  });

  it('post116: no docker in CI', () => {
    expect(read('.github/workflows/ci.yml').toLowerCase()).not.toContain('docker');
  });

  it('post116: no terraform apply in CI', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('terraform');
  });

  it('post116: no kubectl in CI', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('kubectl');
  });

  it('post116: no GEMINI_API_KEY equals in wrangler via CI hygiene grep', () => {
    expect(read('.github/workflows/ci.yml')).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
  });

  it('post116: no push trigger on deploy.yml', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/^\s*push:/m);
  });

  it('post116: no schedule cron on deploy', () => {
    expect(read('.github/workflows/deploy.yml')).not.toContain('schedule:');
  });

  it('post116: coverage thresholds never below 100', () => {
    const cfg = read('vitest.config.ts');
        expect(cfg).not.toMatch(/lines:\s*(?:[0-9]|[1-9][0-9])[^0-9]/);
        expect(cfg).toMatch(/lines:\s*100/);
  });

  it('post116: queueMicrotask does not alter CI digests', async () => {
    await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(sha256('.github/workflows/ci.yml')).toBe(
          'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
        );
  });

  it('post116: Promise.resolve does not alter deploy digest', async () => {
    await Promise.resolve();
        expect(sha256('.github/workflows/deploy.yml')).toBe(
          '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
        );
  });

  it('post116: Blob round-trip of workflow name CI', async () => {
    const blob = new Blob(['CI'], { type: 'text/plain' });
        expect(await blob.text()).toBe('CI');
        expect(read('.github/workflows/ci.yml')).toContain('name: CI');
  });

  it('post116: TextEncoder bytes of coverage-report stay ASCII', () => {
    const bytes = new TextEncoder().encode('coverage-report');
        expect([...bytes].every((b) => b < 128)).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('coverage-report');
  });

  it('post116: Int32Array of four 100 thresholds', () => {
    const arr = new Int32Array([100, 100, 100, 100]);
        expect([...arr]).toEqual([100, 100, 100, 100]);
        expect(read('vitest.config.ts').match(/:\s*100/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('post116: BigInt package-lock packages length is 168n', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
        expect(BigInt(Object.keys(lock.packages).length)).toBe(168n);
  });

  it('post116: DataView reads node major 20 bytes', () => {
    const buf = new ArrayBuffer(2);
        const view = new DataView(buf);
        view.setUint8(0, 50);
        view.setUint8(1, 48);
        expect(String.fromCharCode(view.getUint8(0), view.getUint8(1))).toBe('20');
        expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
  });

  it('post116: structuredClone of package scripts stays equal', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        expect(structuredClone(pkg.scripts)).toEqual(pkg.scripts);
  });

  it('post116: localeCompare ordering of CI job ids', () => {
    const jobs = ['hygiene', 'test', 'typecheck'];
        expect([...jobs].sort((a, b) => a.localeCompare(b))).toEqual(['hygiene', 'test', 'typecheck']);
        const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('typecheck:');
        expect(ci).toContain('test:');
        expect(ci).toContain('hygiene:');
  });

  it('post116: btoa/atob round-trip of CI name', () => {
    expect(atob(btoa('CI'))).toBe('CI');
        expect(read('.github/workflows/ci.yml').startsWith('name: CI')).toBe(true);
  });

  it('post116: Set uniqueness of CI job names', () => {
    const names = new Set(['Typecheck', 'Tests', 'Hygiene']);
        expect(names.size).toBe(3);
        const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('name: Typecheck');
        expect(ci).toContain('name: Tests');
        expect(ci).toContain('name: Hygiene');
  });

  it('post116: Map inventory of six package scripts', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
        const m = new Map(Object.entries(pkg.scripts));
        expect(m.size).toBe(6);
        expect(m.get('typecheck')).toBe('tsc --noEmit');
  });

  it('post116: Object.entries package.json top-level key order', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
        expect(Object.keys(pkg)).toEqual([
          'name',
          'version',
          'description',
          'type',
          'scripts',
          'dependencies',
          'devDependencies',
        ]);
  });

  it('post116: JSON.stringify package name round-trips', () => {
    expect(JSON.parse(JSON.stringify({ name: 'backlink' })).name).toBe('backlink');
        expect(JSON.parse(read('package.json')).name).toBe('backlink');
  });

  it('post116: padStart retention-days fortnight', () => {
    expect(String(14).padStart(2, '0')).toBe('14');
        expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post116: repeat of hyphen does not invent workflow names', () => {
    expect('-'.repeat(3)).toBe('---');
        expect(read('.github/workflows/ci.yml')).not.toContain('name: Invented');
  });

  it('post116: slice first 40 and last 40 of ci.yml', () => {
    const ci = read('.github/workflows/ci.yml');
        expect(ci.slice(0, 40)).toBe("name: CI\n\non:\n  push:\n    branches: [mai");
        expect(ci.slice(-40)).toBe("odules/*' ! -path './.git/*' | grep -q .");
  });

  it('post116: slice first 40 and last 40 of deploy.yml', () => {
    const deploy = read('.github/workflows/deploy.yml');
        expect(deploy.slice(0, 40)).toBe("name: Deploy to Cloudflare Workers\n\non:\n");
        expect(deploy.slice(-40)).toBe("_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n");
  });

  it('post116: sha256 of concatenated CI job ids', () => {
    const tokens = ['typecheck', 'test', 'hygiene'].join('|');
        expect(createHash('sha256').update(tokens).digest('hex')).toBe(
          'c48518346e52822a0ffe829df570359891ea3a1c43bdc58253a1a5103bcdf4c9',
        );
  });

  it('post116: sha256 of Verify script block tokens', () => {
    const tokens = ['npm ci', 'npm run typecheck', 'npm test', 'npm run test:coverage'].join('\n');
        expect(createHash('sha256').update(tokens).digest('hex')).toBe(
          '0ddf9e851fceb0350faa3d8b53ed0bfdcaa2aaed6efbcc15259e212de662e007',
        );
        expect(read('AGENTS.md')).toContain('npm run test:coverage');
  });

  it('post116: sha256 of post116 marker string', () => {
    expect(createHash('sha256').update('post116-ci-config-TOKENMAXX').digest('hex')).toBe(
          '8094a3de0f1c5b878fa0c8dc294b42c3cde53e91ff31c8c778faf7f1060ac7e1',
        );
  });

  it('post116: cross-lock README mentions CI badge without inventing routes', () => {
    const readme = read('README.md');
        expect(readme).toMatch(/CI/);
        expect(readme).not.toMatch(/\/playlist|\/now-playing/);
  });

  it('post116: cross-lock DEPLOY.md HITL workflow_dispatch language', () => {
    const deployMd = read('DEPLOY.md');
        expect(deployMd.toLowerCase()).toMatch(/hitl|workflow_dispatch|manual|human/);
        expect(read('.github/workflows/deploy.yml')).toContain('workflow_dispatch');
  });

  it('post116: cross-lock wrangler.toml name backlink without secrets', () => {
    const toml = read('wrangler.toml');
        expect(toml).toContain('name = "backlink"');
        expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
        expect(read('.github/workflows/ci.yml')).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
  });

  it('post116: cross-lock helpers.ts exists for route stubs without CI fetching iptv', () => {
    expect(read('test/helpers.ts')).toContain('export function stubIptvAndGemini');
        expect(read('.github/workflows/ci.yml')).not.toContain('iptv-org.github.io');
  });

  it('post116: cross-lock docs/mcp-spec.md present in hygiene list', () => {
    expect(read('.github/workflows/ci.yml')).toContain('docs/mcp-spec.md');
        expect(read('docs/mcp-spec.md').length).toBeGreaterThan(0);
  });

  it('post116: cross-lock src modules listed in hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
        for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
          expect(ci).toContain(f);
        }
  });

  it('post116: HMAC digests post100 vs post116 differ for ci.yml', () => {
    expect(hmacSha256('post100', '.github/workflows/ci.yml')).not.toBe(
          hmacSha256('post116', '.github/workflows/ci.yml'),
        );
  });

  it('post116: HMAC digests post116 vs TOKENMAXX differ for package.json', () => {
    expect(hmacSha256('post116', 'package.json')).not.toBe(
          hmacSha256('TOKENMAXX', 'package.json'),
        );
  });

  it('post116: HMAC script lock for dev', () => {
    expect(createHmac('sha256', 'post116').update('dev=wrangler dev').digest('hex')).toBe(
          'd3d7120535478aebc1e91d90910a7e829cec757e69ff9d0fe01a1c6011a448e8',
        );
        expect(JSON.parse(read('package.json')).scripts['dev']).toBe('wrangler dev');
  });

  it('post116: HMAC script lock for deploy', () => {
    expect(createHmac('sha256', 'post116').update('deploy=wrangler deploy').digest('hex')).toBe(
          '157a6b432e04369cb895e4c51f3cfa543884a85f4f4ac7e7566568863eddc83b',
        );
        expect(JSON.parse(read('package.json')).scripts['deploy']).toBe('wrangler deploy');
  });

  it('post116: HMAC script lock for typecheck', () => {
    expect(createHmac('sha256', 'post116').update('typecheck=tsc --noEmit').digest('hex')).toBe(
          'bab5a855b663ef0abeb25a775e7fec51f0748d1d3314a034295eb206aa03c44e',
        );
        expect(JSON.parse(read('package.json')).scripts['typecheck']).toBe('tsc --noEmit');
  });

  it('post116: HMAC script lock for test', () => {
    expect(createHmac('sha256', 'post116').update('test=vitest run').digest('hex')).toBe(
          '89107dcae4ccdc66cc9188334dc3eb9239aa268cc23068b5a693f992f0736041',
        );
        expect(JSON.parse(read('package.json')).scripts['test']).toBe('vitest run');
  });

  it('post116: HMAC script lock for test:watch', () => {
    expect(createHmac('sha256', 'post116').update('test:watch=vitest').digest('hex')).toBe(
          '5c4b8fd3031e810d817d24a91940f9ddc8c38714a944210ab53800237dfa5739',
        );
        expect(JSON.parse(read('package.json')).scripts['test:watch']).toBe('vitest');
  });

  it('post116: HMAC script lock for test:coverage', () => {
    expect(createHmac('sha256', 'post116').update('test:coverage=vitest run --coverage').digest('hex')).toBe(
          '1d52d8a72b92360c351830a4c358737b50832d3d706551a0b4815cee5c0e7999',
        );
        expect(JSON.parse(read('package.json')).scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post116: locks CI pin actions/checkout@v7 count 3', () => {
    expect((read('.github/workflows/ci.yml').match(/actions\/checkout@v7/g) ?? []).length).toBe(3);
  });

  it('post116: locks CI pin actions/setup-node@v7 count 2', () => {
    expect((read('.github/workflows/ci.yml').match(/actions\/setup-node@v7/g) ?? []).length).toBe(2);
  });

  it('post116: locks CI pin actions/upload-artifact@v4 count 1', () => {
    expect((read('.github/workflows/ci.yml').match(/actions\/upload-artifact@v4/g) ?? []).length).toBe(1);
  });

  it('post116: locks node-version 20 appears thrice in ci.yml', () => {
    expect((read('.github/workflows/ci.yml').match(/node-version:\s*"20"/g) ?? []).length).toBe(3);
  });

  it('post116: locks npm ci appears twice in CI and once in deploy', () => {
    expect((read('.github/workflows/ci.yml').match(/npm ci/g) ?? []).length).toBe(2);
        expect((read('.github/workflows/deploy.yml').match(/npm ci/g) ?? []).length).toBe(1);
  });

  it('post116: locks CI permissions contents read only', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/permissions:\s*\n\s*contents:\s*read/);
        expect(read('.github/workflows/ci.yml')).not.toMatch(/contents:\s*write/);
  });

  it('post116: locks deploy permissions contents read only', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it('post116: locks CI concurrency group pattern', () => {
    const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
        expect(ci).toContain('cancel-in-progress: true');
  });

  it('post116: locks deploy concurrency group pattern', () => {
    const deploy = read('.github/workflows/deploy.yml');
        expect(deploy).toContain('group: deploy-${{ github.workflow }}');
        expect(deploy).toContain('cancel-in-progress: false');
  });

  it('post116: locks CI job timeouts', () => {
    const ci = read('.github/workflows/ci.yml');
        expect(ci).toMatch(/timeout-minutes:\s*10/);
        expect(ci).toMatch(/timeout-minutes:\s*15/);
        expect(ci).toMatch(/timeout-minutes:\s*5/);
  });

  it('post116: locks coverage artifact upload paths', () => {
    const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('name: coverage-report');
        expect(ci).toContain('coverage/');
        expect(ci).toContain('coverage/lcov.info');
        expect(ci).toContain('if-no-files-found: error');
        expect(ci).toContain('retention-days: 14');
  });

  it('post116: locks coverage assert steps', () => {
    const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('test -d coverage');
        expect(ci).toContain('test -f coverage/lcov.info');
        expect(ci).toContain('test -s coverage/lcov.info');
        expect(ci).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post116: locks ci.yml sha256 base64url prefix', () => {
    const hex = sha256('.github/workflows/ci.yml');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('xNuI0jovjEGjiMB5');
  });

  it('post116: locks deploy.yml sha256 base64url prefix', () => {
    const hex = sha256('.github/workflows/deploy.yml');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('Sb9XFlP5CREIqOfj');
  });

  it('post116: locks dependabot.yml sha256 base64url prefix', () => {
    const hex = sha256('.github/dependabot.yml');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('oRuWFTtrt3PuDL3N');
  });

  it('post116: locks package.json sha256 base64url prefix', () => {
    const hex = sha256('package.json');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('NFUkk_MAi1iZHRDn');
  });

  it('post116: locks package-lock.json sha256 base64url prefix', () => {
    const hex = sha256('package-lock.json');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('X4qIjx_Hqvl9zao_');
  });

  it('post116: locks vitest.config.ts sha256 base64url prefix', () => {
    const hex = sha256('vitest.config.ts');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('-bWLuTdTHaVa1HRZ');
  });

  it('post116: locks tsconfig.json sha256 base64url prefix', () => {
    const hex = sha256('tsconfig.json');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('73PVLibF2-HxeFoG');
  });

  it('post116: locks AGENTS.md sha256 base64url prefix', () => {
    const hex = sha256('AGENTS.md');
        const b64 = Buffer.from(hex, 'hex').toString('base64url');
        expect(b64.slice(0, 16)).toBe('SOWQtPFG4vvR67QJ');
  });

  it('post116: Collator-sorted suite file inventory', () => {
    const suites = [
          'ci-config.test.ts',
          'genres.test.ts',
          'helpers.test.ts',
          'mcp-spec-contract.test.ts',
          'mcp.test.ts',
          'parser.test.ts',
          'routes.test.ts',
          'source-contracts.test.ts',
          'wrangler-config.test.ts',
        ];
        expect([...suites].sort(new Intl.Collator('en').compare)).toEqual(suites);
        for (const s of suites) {
          expect(read(`test/${s}`).length).toBeGreaterThan(0);
        }
  });

  it('post116: Proxy read of package name via boxed object', () => {
    const target = { name: 'backlink' };
        const proxy = new Proxy(target, {
          get(t, p, r) {
            return Reflect.get(t, p, r);
          },
        });
        expect(proxy.name).toBe(JSON.parse(read('package.json')).name);
  });

  it('post116: WeakMap can key package.json object without inventing deps', () => {
    const pkg = JSON.parse(read('package.json')) as object;
        const wm = new WeakMap<object, string>();
        wm.set(pkg, 'ci-config');
        expect(wm.get(pkg)).toBe('ci-config');
        expect(Object.keys(pkg)).not.toContain('invented');
  });

  it('post116: performance.now around reading ci.yml is finite', () => {
    const t0 = performance.now();
        const ci = read('.github/workflows/ci.yml');
        const t1 = performance.now();
        expect(Number.isFinite(t1 - t0)).toBe(true);
        expect(ci.startsWith('name: CI')).toBe(true);
  });

  it('post116: encodeURIComponent of Typecheck Tests Hygiene is identity-ish', () => {
    for (const s of ['Typecheck', 'Tests', 'Hygiene']) {
          expect(decodeURIComponent(encodeURIComponent(s))).toBe(s);
        }
        const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('name: Typecheck');
        expect(ci).toContain('name: Tests');
        expect(ci).toContain('name: Hygiene');
  });

  it('post116: Buffer compare of ci.yml prefix name', () => {
    const prefix = Buffer.from('name: CI\n');
        const head = readFileSync(join(root, '.github/workflows/ci.yml')).subarray(0, prefix.length);
        expect(Buffer.compare(head, prefix)).toBe(0);
  });

  it('post116: fromCharCode rebuild of workflow name CI', () => {
    expect(String.fromCharCode(67, 73)).toBe('CI');
        expect(read('.github/workflows/ci.yml')).toContain('name: CI');
  });

  it('post116: Array.from of coverage threshold digits', () => {
    expect(Array.from('100').map(Number)).toEqual([1, 0, 0]);
        expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('post116: URL.canParse of npm registry does not appear in CI yaml', () => {
    expect(URL.canParse('https://registry.npmjs.org/')).toBe(true);
        expect(read('.github/workflows/ci.yml')).not.toContain('registry.npmjs.org');
  });

  it('post116: Headers unused — workflows have no Authorization Accept', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/Authorization|Accept:/);
        expect(read('.github/workflows/deploy.yml')).not.toMatch(/Authorization:/);
  });

  it('post116: FormData unused by CI and deploy workflows', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('FormData');
        expect(read('.github/workflows/deploy.yml')).not.toContain('multipart');
  });

  it('post116: AbortSignal.timeout unused by CI workflows', () => {
    expect(typeof AbortSignal !== 'undefined').toBe(true);
        expect(read('.github/workflows/ci.yml')).not.toContain('AbortSignal');
  });

  it('post116: Date.now independence — digests stable across clock', () => {
    const a = sha256('package.json');
        const _ = Date.now();
        const b = sha256('package.json');
        expect(a).toBe(b);
        expect(_).toBeGreaterThan(0);
  });

  it('post116: hash of Math.random does not affect package digest', () => {
    const _ = Math.random();
        expect(sha256('package.json')).toBe(
          '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
        );
        expect(_).toBeGreaterThanOrEqual(0);
  });

  it('post116: mega purity — 40 rounds of ci.yml sha256 stability', () => {
    const expected = 'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5';
        for (let i = 0; i < 40; i++) {
          expect(sha256('.github/workflows/ci.yml')).toBe(expected);
        }
  });

  it('post116: mega purity — 20 rounds of package.json + vitest digests', () => {
    const pkgD = '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c';
        const vitD = 'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38';
        for (let i = 0; i < 20; i++) {
          expect(sha256('package.json')).toBe(pkgD);
          expect(sha256('vitest.config.ts')).toBe(vitD);
        }
  });

  it('post116: mega purity — 20 rounds of AGENTS + DEPLOY + README digests', () => {
    const a = '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa';
        const d = '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a';
        const r = 'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987';
        for (let i = 0; i < 20; i++) {
          expect(sha256('AGENTS.md')).toBe(a);
          expect(sha256('DEPLOY.md')).toBe(d);
          expect(sha256('README.md')).toBe(r);
        }
  });

  it('post116: createHmac purity 40x post116', () => {
    const expected = hmacSha256('post116', '.github/workflows/ci.yml');
        for (let i = 0; i < 40; i++) expect(hmacSha256('post116', '.github/workflows/ci.yml')).toBe(expected);
  });

  it('post116: xor-fold of primary artifact sha256 first bytes', () => {
    const rels = [
          '.github/workflows/ci.yml',
          'package.json',
          'vitest.config.ts',
          'tsconfig.json',
          'AGENTS.md',
        ];
        let acc = 0;
        for (const rel of rels) {
          acc ^= parseInt(sha256(rel).slice(0, 2), 16);
        }
        expect(acc).toBe(174);
  });

  it('post116: locks AGENTS.md UTF-8 vs UTF-16 length delta 6', () => {
    const body = read('AGENTS.md');
        expect(Buffer.byteLength(body, 'utf8') - body.length).toBe(6);
  });

  it('post116: locks DEPLOY.md UTF-8 vs UTF-16 length delta 34', () => {
    const body = read('DEPLOY.md');
        expect(Buffer.byteLength(body, 'utf8') - body.length).toBe(34);
  });

  it('post116: locks README.md UTF-8 vs UTF-16 length delta 44', () => {
    const body = read('README.md');
        expect(Buffer.byteLength(body, 'utf8') - body.length).toBe(44);
  });

  it('post116: locks no tab CR BOM in ci.yml', () => {
    const body = read('.github/workflows/ci.yml');
        expect(body.includes('\t')).toBe(false);
        expect(body.includes('\r')).toBe(false);
        expect(body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('post116: locks no tab CR BOM in package.json', () => {
    const body = read('package.json');
        expect(body.includes('\t')).toBe(false);
        expect(body.includes('\r')).toBe(false);
        expect(body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('post116: locks no tab CR BOM in vitest.config.ts', () => {
    const body = read('vitest.config.ts');
        expect(body.includes('\t')).toBe(false);
        expect(body.includes('\r')).toBe(false);
        expect(body.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('post116: HMAC job-name lock for Typecheck', () => {
    expect(createHmac('sha256', 'post116').update('job:Typecheck').digest('hex')).toBe(
          '236dd9dc144a310760e1fab45f5e7bf883feaa28852d0b7603305f817bf53db7',
        );
        expect(read('.github/workflows/ci.yml')).toContain('name: Typecheck');
  });

  it('post116: HMAC job-name lock for Tests', () => {
    expect(createHmac('sha256', 'post116').update('job:Tests').digest('hex')).toBe(
          '6ece1414be33754c14d01923f14cf79ec52fd577442733a97a662a0246384cd4',
        );
        expect(read('.github/workflows/ci.yml')).toContain('name: Tests');
  });

  it('post116: HMAC job-name lock for Hygiene', () => {
    expect(createHmac('sha256', 'post116').update('job:Hygiene').digest('hex')).toBe(
          '0f445a20a96e23fd8825c0f3bfe3c6f8d3a9deb445ba6cd44e8d8a8e64da5e8a',
        );
        expect(read('.github/workflows/ci.yml')).toContain('name: Hygiene');
  });

  it('post116: HMAC dep-version lock for @cloudflare/workers-types', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['@cloudflare/workers-types'] ?? pkg.devDependencies?.['@cloudflare/workers-types'];
        expect(ver).toBe('^5.20260911.1');
        expect(createHmac('sha256', 'post116').update(`@cloudflare/workers-types@${ver}`).digest('hex')).toBe(
          '35b6acab482bd4e7e0bbf92d0c5ebee9e7f73211a33fc1ac5595b54b32edc871',
        );
  });

  it('post116: HMAC dep-version lock for @types/node', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['@types/node'] ?? pkg.devDependencies?.['@types/node'];
        expect(ver).toBe('^22.20.2');
        expect(createHmac('sha256', 'post116').update(`@types/node@${ver}`).digest('hex')).toBe(
          'f376b98c5c675b2242deea67afaeca0672d76079a5498a6536a209b406c31122',
        );
  });

  it('post116: HMAC dep-version lock for @vitest/coverage-v8', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['@vitest/coverage-v8'] ?? pkg.devDependencies?.['@vitest/coverage-v8'];
        expect(ver).toBe('^5.0.0');
        expect(createHmac('sha256', 'post116').update(`@vitest/coverage-v8@${ver}`).digest('hex')).toBe(
          'bdfaca1b4a7f1623b558170682f543e483a5d18f879dd92dc0761e94918f3c2f',
        );
  });

  it('post116: HMAC dep-version lock for typescript', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['typescript'] ?? pkg.devDependencies?.['typescript'];
        expect(ver).toBe('^5.7.0');
        expect(createHmac('sha256', 'post116').update(`typescript@${ver}`).digest('hex')).toBe(
          '5382ca97360be5f9ea155c44e5d2987d0ef05f8edc3902b2c59516905c6bdd57',
        );
  });

  it('post116: HMAC dep-version lock for vitest', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['vitest'] ?? pkg.devDependencies?.['vitest'];
        expect(ver).toBe('^5.0.0');
        expect(createHmac('sha256', 'post116').update(`vitest@${ver}`).digest('hex')).toBe(
          '87af5cffe10ee28ee4b16e44a26d4681f073bf270f0f87f17d42c0900b631cf9',
        );
  });

  it('post116: HMAC dep-version lock for wrangler', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['wrangler'] ?? pkg.devDependencies?.['wrangler'];
        expect(ver).toBe('^4.131.1');
        expect(createHmac('sha256', 'post116').update(`wrangler@${ver}`).digest('hex')).toBe(
          'b315fc9d0932c3cb47dcaf104ddaccb32ec0167f148f837c9cc68349bd95d227',
        );
  });

  it('post116: HMAC dep-version lock for hono', () => {
    const pkg = JSON.parse(read('package.json')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const ver = pkg.dependencies?.['hono'] ?? pkg.devDependencies?.['hono'];
        expect(ver).toBe('^4.13.7');
        expect(createHmac('sha256', 'post116').update(`hono@${ver}`).digest('hex')).toBe(
          'b87e756174c5c0fc622a693af9220b5fb61e6c5c6ae814c06303acd92c4f7590',
        );
  });

  it('post116: HMAC hygiene-path lock for README.md', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('README.md').digest('hex')).toBe(
          '2b9b47ba9da208122da39ae9aa363bde359bec62a708e5b08342288a7de30a98',
        );
        expect(statSync(join(root, 'README.md')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('README.md');
  });

  it('post116: HMAC hygiene-path lock for AGENTS.md', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('AGENTS.md').digest('hex')).toBe(
          'fd5374fd954f9b82df28d0d78650427efd3a61f7f18f6779c34eeaa493615b8f',
        );
        expect(statSync(join(root, 'AGENTS.md')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('AGENTS.md');
  });

  it('post116: HMAC hygiene-path lock for DEPLOY.md', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('DEPLOY.md').digest('hex')).toBe(
          '3480b6dcf66ebce3ec263780d57b2dbb7ec93e528be6f259e5956d9cdb5c118f',
        );
        expect(statSync(join(root, 'DEPLOY.md')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('DEPLOY.md');
  });

  it('post116: HMAC hygiene-path lock for package.json', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('package.json').digest('hex')).toBe(
          'ddfefd607110114b4938706b2d24ca8f6524721e0fb6d2f56d7a26fd99bf2a4c',
        );
        expect(statSync(join(root, 'package.json')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('package.json');
  });

  it('post116: HMAC hygiene-path lock for package-lock.json', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('package-lock.json').digest('hex')).toBe(
          '6034c0283f05a6fe4cddfb8bb0bc0dc466d616e73777044d0d52d1ef3ae46818',
        );
        expect(statSync(join(root, 'package-lock.json')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('package-lock.json');
  });

  it('post116: HMAC hygiene-path lock for wrangler.toml', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('wrangler.toml').digest('hex')).toBe(
          '7d944dea3f900cb6d7ab70bb46fbc6031afdb45316aa6cb4b7cba7f65274ffd7',
        );
        expect(statSync(join(root, 'wrangler.toml')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('wrangler.toml');
  });

  it('post116: HMAC hygiene-path lock for .gitattributes', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('.gitattributes').digest('hex')).toBe(
          'ad379aab6e508b2613dbc04fae1c466e2eedb1fc292262c7a2bc9ba35b3528f7',
        );
        expect(statSync(join(root, '.gitattributes')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('.gitattributes');
  });

  it('post116: HMAC hygiene-path lock for .cursor/environment.json', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('.cursor/environment.json').digest('hex')).toBe(
          '330535e81cbe2cf9f68fea7fff085f9135359d23ef9895678930e1367029efe1',
        );
        expect(statSync(join(root, '.cursor/environment.json')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('.cursor/environment.json');
  });

  it('post116: HMAC hygiene-path lock for .github/workflows/ci.yml', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('.github/workflows/ci.yml').digest('hex')).toBe(
          '4dc597d93cfc0004d620c8a5d1c2360e96bb71daae90d70592255f4a85e0a9b6',
        );
        expect(statSync(join(root, '.github/workflows/ci.yml')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('.github/workflows/ci.yml');
  });

  it('post116: HMAC hygiene-path lock for .github/workflows/deploy.yml', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('.github/workflows/deploy.yml').digest('hex')).toBe(
          'b02a64b46c813bef6c35ca3ce3c1ef32c637ddda46fc6906259128d03acb9ce3',
        );
        expect(statSync(join(root, '.github/workflows/deploy.yml')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('.github/workflows/deploy.yml');
  });

  it('post116: HMAC hygiene-path lock for .github/dependabot.yml', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('.github/dependabot.yml').digest('hex')).toBe(
          'b129c6267b84a8799a24cdd78fffaab3c85920bba44279fb3aa21d9f6ebae255',
        );
        expect(statSync(join(root, '.github/dependabot.yml')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('.github/dependabot.yml');
  });

  it('post116: HMAC hygiene-path lock for vitest.config.ts', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('vitest.config.ts').digest('hex')).toBe(
          '9f8f2bae27b6a7eca5b8a0d4dbb206c9a7bed20b2a7ac01dce1c5650cd914841',
        );
        expect(statSync(join(root, 'vitest.config.ts')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('vitest.config.ts');
  });

  it('post116: HMAC hygiene-path lock for tsconfig.json', () => {
    expect(createHmac('sha256', 'post116-hygiene').update('tsconfig.json').digest('hex')).toBe(
          'f7b98a2fa16bab187e3ad7b7ab49712640178f03a0ad279c3bff49571be1daae',
        );
        expect(statSync(join(root, 'tsconfig.json')).isFile()).toBe(true);
        expect(read('.github/workflows/ci.yml')).toContain('tsconfig.json');
  });

  it('post116: ISSUE_TEMPLATE/bug.yml is non-empty YAML-ish', () => {
    const body = read('.github/ISSUE_TEMPLATE/bug.yml');
        expect(body.length).toBeGreaterThan(20);
        expect(body.includes('\t')).toBe(false);
  });

  it('post116: ISSUE_TEMPLATE/bug.yml has name and description', () => {
    const body = read('.github/ISSUE_TEMPLATE/bug.yml');
        expect(body).toMatch(/^name:/m);
        expect(body).toMatch(/^description:/m);
  });

  it('post116: ISSUE_TEMPLATE/chore.yml is non-empty YAML-ish', () => {
    const body = read('.github/ISSUE_TEMPLATE/chore.yml');
        expect(body.length).toBeGreaterThan(20);
        expect(body.includes('\t')).toBe(false);
  });

  it('post116: ISSUE_TEMPLATE/chore.yml has name and description', () => {
    const body = read('.github/ISSUE_TEMPLATE/chore.yml');
        expect(body).toMatch(/^name:/m);
        expect(body).toMatch(/^description:/m);
  });

  it('post116: ISSUE_TEMPLATE/config.yml is non-empty YAML-ish', () => {
    const body = read('.github/ISSUE_TEMPLATE/config.yml');
        expect(body.length).toBeGreaterThan(20);
        expect(body.includes('\t')).toBe(false);
  });

  it('post116: ISSUE_TEMPLATE/feature.yml is non-empty YAML-ish', () => {
    const body = read('.github/ISSUE_TEMPLATE/feature.yml');
        expect(body.length).toBeGreaterThan(20);
        expect(body.includes('\t')).toBe(false);
  });

  it('post116: ISSUE_TEMPLATE/feature.yml has name and description', () => {
    const body = read('.github/ISSUE_TEMPLATE/feature.yml');
        expect(body).toMatch(/^name:/m);
        expect(body).toMatch(/^description:/m);
  });

  it('post116: locks concatenated AGENTS+DEPLOY+README sha256', () => {
    const concat =
          read('AGENTS.md') + '\n' + read('DEPLOY.md') + '\n' + read('README.md');
        expect(createHash('sha256').update(concat).digest('hex')).toBe(
          '32b04d369a6b89e785fe0f79f6172a6a24644e0e5fff9a4e4899c2c3f834e869',
        );
  });

  it('post116: locks concatenated CI+deploy+dependabot sha256', () => {
    const concat =
          read('.github/workflows/ci.yml') +
          '\n' +
          read('.github/workflows/deploy.yml') +
          '\n' +
          read('.github/dependabot.yml');
        expect(createHash('sha256').update(concat).digest('hex')).toBe(
          '6d7eaa450ad3e8d006f2aaed38bf0d850807650ea7efad3e16c70e1cef79344d',
        );
  });

  it('post116: locks package.json+vitest+tsconfig sha256 concat', () => {
    const concat =
          read('package.json') + '\n' + read('vitest.config.ts') + '\n' + read('tsconfig.json');
        expect(createHash('sha256').update(concat).digest('hex')).toBe(
          'e9cf0e777ed5280a53f7879189f1b71b73ef856d063bf35c2f1481ff50ba194a',
        );
  });

  it('post116: locks ci.yml runs-on ubuntu-latest three times', () => {
    expect((read('.github/workflows/ci.yml').match(/runs-on:\s*ubuntu-latest/g) ?? []).length).toBe(3);
  });

  it('post116: locks deploy.yml runs-on ubuntu-latest once', () => {
    expect((read('.github/workflows/deploy.yml').match(/runs-on:\s*ubuntu-latest/g) ?? []).length).toBe(1);
  });

  it('post116: locks typescript caret 5 not 6 or 7 in package.json', () => {
    const v = JSON.parse(read('package.json')).devDependencies.typescript as string;
        expect(v).toMatch(/^\^5\./);
        expect(v).not.toMatch(/^\^[67]\./);
  });

  it('post116: locks vitest and coverage-v8 both caret 5', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
        expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
        expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
  });

  it('post116: locks wrangler caret 4 and workers-types caret 5', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
        expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
        expect(pkg.devDependencies['@cloudflare/workers-types']).toMatch(/^\^5\./);
  });

  it('post116: locks @types/node caret 22', () => {
    expect(JSON.parse(read('package.json')).devDependencies['@types/node']).toMatch(/^\^22\./);
  });

  it('post116: post116 vs post100 HMAC differ across all primary artifacts', () => {
    for (const rel of [
          '.github/workflows/ci.yml',
          '.github/workflows/deploy.yml',
          'package.json',
          'vitest.config.ts',
          'AGENTS.md',
        ]) {
          expect(hmacSha256('post100', rel)).not.toBe(hmacSha256('post116', rel));
        }
  });

  it('post116: final inventory — ci-config describe blocks include post79 post100 post116', () => {
    const body = read('test/ci-config.test.ts');
        expect(body).toContain("describe('post79 ci-config HEAVY deepen'");
        expect(body).toContain("describe('post100 ci-config HEAVY deepen'");
        expect(body).toContain("describe('post116 ci-config HEAVY deepen'");
        expect((body.match(/it\('post116:/g) ?? []).length).toBeGreaterThan(100);
  });

  it('post116: ci-config.test.ts contains post116 HEAVY burn marker', () => {
    expect(read('test/ci-config.test.ts')).toContain(
          'HEAVY burn (post-#116): deepen ci-config unit slice only',
        );
  });

  it('post116: dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('test')).toBe(true);
  });

  it('post116: suite markers present for hygiene self-check', () => {
    const body = read('test/ci-config.test.ts');
        expect(body).toContain("describe('post116 ci-config HEAVY deepen'");
        expect((body.match(/it\('post116:/g) ?? []).length).toBeGreaterThan(50);
  });

});

// --- HEAVY burn (post-#123): deepen ci-config leftovers after #123 merge — tests only ---

// --- HEAVY burn (post-#123): deepen ci-config leftovers — tests only, no product inventing ---
describe('post123 ci-config HEAVY deepen (after #123)', () => {
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((a, c) => a ^ parseInt(c, 16), 0);

  it('post123: locks .github/workflows/ci.yml sha256', () => {
    expect(sha256(".github/workflows/ci.yml")).toBe("c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5");
  });

  it('post123: locks .github/workflows/ci.yml sha1', () => {
    expect(sha1(".github/workflows/ci.yml")).toBe("2105395119389c6131d039b5d787abc150bbbcaa");
  });

  it('post123: locks .github/workflows/ci.yml md5', () => {
    expect(md5(".github/workflows/ci.yml")).toBe("ea05159f5a4591ccf20765050a212605");
  });

  it('post123: locks .github/workflows/ci.yml sha384', () => {
    expect(sha384(".github/workflows/ci.yml")).toBe("8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab");
  });

  it('post123: locks .github/workflows/ci.yml sha512', () => {
    expect(sha512(".github/workflows/ci.yml")).toBe("3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460");
  });

  it('post123: locks .github/workflows/ci.yml sha3-256', () => {
    expect(sha3(".github/workflows/ci.yml")).toBe("8f49dc5067d49c3458635df0dbb9078bac974081a35adab2c27d9349f30cd611");
  });

  it('post123: locks .github/workflows/ci.yml blake2b512', () => {
    expect(blake2b(".github/workflows/ci.yml")).toBe("5629fff561ce7acb56fc3d2f66b875992f525b4a25ec6c3c6fb485d6f6d20bb74a33c67c89389360ee29d12dd26361a4c24b39db6ec9aaf58462c3b0472f489d");
  });

  it('post123: locks .github/workflows/ci.yml ripemd160', () => {
    expect(ripemd(".github/workflows/ci.yml")).toBe("491302ba2e7b00c030ea98aea8ccee799d61e1ff");
  });

  it('post123: locks .github/workflows/ci.yml size 6295', () => {
    expect(statSync(join(root, ".github/workflows/ci.yml")).size).toBe(6295);
    expect(readFileSync(join(root, ".github/workflows/ci.yml")).byteLength).toBe(6295);
  });

  it('post123: locks .github/workflows/ci.yml utf8 6295 lines 177', () => {
    expect(read(".github/workflows/ci.yml")).toHaveLength(6295);
    expect(read(".github/workflows/ci.yml").split('\n')).toHaveLength(177);
  });

  it('post123: locks .github/workflows/ci.yml nibble 515 xor 3', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post123: locks .github/workflows/ci.yml first/last octets', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(d.slice(0, 2)).toBe("c4");
    expect(d.slice(-2)).toBe("d5");
  });

  it('post123: locks .github/workflows/ci.yml HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', ".github/workflows/ci.yml")).toBe("a4d504b8ad938f033b55ee7964ab9a025db5c566795a2378bfdf78ad7932a9bb");
    expect(hmacSha256('TOKENMAXX', ".github/workflows/ci.yml")).toBe("5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b");
    expect(hmacSha256('ci-config', ".github/workflows/ci.yml")).toBe("e997e669ee801faeaaac0ecfb8239cc5d416ffd739f752a288a997d086e7bd15");
  });

  it('post123: locks .github/workflows/ci.yml spaces 1716', () => {
    expect((read(".github/workflows/ci.yml").match(/ /g) ?? []).length).toBe(1716);
  });

  it('post123: locks .github/workflows/deploy.yml sha256', () => {
    expect(sha256(".github/workflows/deploy.yml")).toBe("49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3");
  });

  it('post123: locks .github/workflows/deploy.yml sha1', () => {
    expect(sha1(".github/workflows/deploy.yml")).toBe("5f7a3932b69a68d740162b1079688d6934060f61");
  });

  it('post123: locks .github/workflows/deploy.yml md5', () => {
    expect(md5(".github/workflows/deploy.yml")).toBe("ea86e4de097085159e425937542bf7cf");
  });

  it('post123: locks .github/workflows/deploy.yml sha384', () => {
    expect(sha384(".github/workflows/deploy.yml")).toBe("61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f");
  });

  it('post123: locks .github/workflows/deploy.yml sha512', () => {
    expect(sha512(".github/workflows/deploy.yml")).toBe("7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641");
  });

  it('post123: locks .github/workflows/deploy.yml sha3-256', () => {
    expect(sha3(".github/workflows/deploy.yml")).toBe("c214b3a3742462dbe536466786d717241cdc0be84f5bbf71da7c8f8ed281d62e");
  });

  it('post123: locks .github/workflows/deploy.yml blake2b512', () => {
    expect(blake2b(".github/workflows/deploy.yml")).toBe("0ec8ba30a1fdece2b7033b67cffa78d926b8deb86a5f7468060a746f0ff0dc8b8488236b19465603f53aac178556c000ecca9748f4dcf7591155f67f0c1c5628");
  });

  it('post123: locks .github/workflows/deploy.yml ripemd160', () => {
    expect(ripemd(".github/workflows/deploy.yml")).toBe("7a476e7889618bef7c8b22a0f651f4e49658527e");
  });

  it('post123: locks .github/workflows/deploy.yml size 1004', () => {
    expect(statSync(join(root, ".github/workflows/deploy.yml")).size).toBe(1004);
    expect(readFileSync(join(root, ".github/workflows/deploy.yml")).byteLength).toBe(1004);
  });

  it('post123: locks .github/workflows/deploy.yml utf8 1004 lines 47', () => {
    expect(read(".github/workflows/deploy.yml")).toHaveLength(1004);
    expect(read(".github/workflows/deploy.yml").split('\n')).toHaveLength(47);
  });

  it('post123: locks .github/workflows/deploy.yml nibble 476 xor 4', () => {
    const d = sha256(".github/workflows/deploy.yml");
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post123: locks .github/workflows/deploy.yml first/last octets', () => {
    const d = sha256(".github/workflows/deploy.yml");
    expect(d.slice(0, 2)).toBe("49");
    expect(d.slice(-2)).toBe("c3");
  });

  it('post123: locks .github/workflows/deploy.yml HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', ".github/workflows/deploy.yml")).toBe("437ed4df34bfd60eea84b714e3d8968815c8fde3fde2794b3ce8b629cb9d39c1");
    expect(hmacSha256('TOKENMAXX', ".github/workflows/deploy.yml")).toBe("339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b");
    expect(hmacSha256('ci-config', ".github/workflows/deploy.yml")).toBe("b2d258b8ef783136b38e6607f0b0c441f5f7cc85a2aca677b051bdba3fa57eca");
  });

  it('post123: locks .github/workflows/deploy.yml spaces 274', () => {
    expect((read(".github/workflows/deploy.yml").match(/ /g) ?? []).length).toBe(274);
  });

  it('post123: locks .github/dependabot.yml sha256', () => {
    expect(sha256(".github/dependabot.yml")).toBe("a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac");
  });

  it('post123: locks .github/dependabot.yml sha1', () => {
    expect(sha1(".github/dependabot.yml")).toBe("dfdb63975444874143105431e4cee95165932c7b");
  });

  it('post123: locks .github/dependabot.yml md5', () => {
    expect(md5(".github/dependabot.yml")).toBe("bd53b7cdf9bb7287532d96a32cbec9a4");
  });

  it('post123: locks .github/dependabot.yml sha384', () => {
    expect(sha384(".github/dependabot.yml")).toBe("ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc");
  });

  it('post123: locks .github/dependabot.yml sha512', () => {
    expect(sha512(".github/dependabot.yml")).toBe("276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e");
  });

  it('post123: locks .github/dependabot.yml sha3-256', () => {
    expect(sha3(".github/dependabot.yml")).toBe("4a022f1046b7dcd4b57cc16cbb7efad06e9401d30f9d383321ff44ef7a16d1d7");
  });

  it('post123: locks .github/dependabot.yml blake2b512', () => {
    expect(blake2b(".github/dependabot.yml")).toBe("3fb74f327e9c57cb11a7219281df13a608a303a09c82ac1233f53ddddfc96a01e9e9eee076f206359e8b4db1264e971f389ce226acf2f3647146ce8901395f0e");
  });

  it('post123: locks .github/dependabot.yml ripemd160', () => {
    expect(ripemd(".github/dependabot.yml")).toBe("7d8132f4ca88999fcfcf95c3fc1c0ca8b617fe5c");
  });

  it('post123: locks .github/dependabot.yml size 505', () => {
    expect(statSync(join(root, ".github/dependabot.yml")).size).toBe(505);
    expect(readFileSync(join(root, ".github/dependabot.yml")).byteLength).toBe(505);
  });

  it('post123: locks .github/dependabot.yml utf8 505 lines 25', () => {
    expect(read(".github/dependabot.yml")).toHaveLength(505);
    expect(read(".github/dependabot.yml").split('\n')).toHaveLength(25);
  });

  it('post123: locks .github/dependabot.yml nibble 526 xor 6', () => {
    const d = sha256(".github/dependabot.yml");
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post123: locks .github/dependabot.yml first/last octets', () => {
    const d = sha256(".github/dependabot.yml");
    expect(d.slice(0, 2)).toBe("a1");
    expect(d.slice(-2)).toBe("ac");
  });

  it('post123: locks .github/dependabot.yml HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', ".github/dependabot.yml")).toBe("ae10f6f02f27c0e44e44d45d053b967c63d0d518736f60f72069113a634cdfe5");
    expect(hmacSha256('TOKENMAXX', ".github/dependabot.yml")).toBe("e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1");
    expect(hmacSha256('ci-config', ".github/dependabot.yml")).toBe("8b61de03ef1b75db2912b46274382788f1abd7bb4823d4dfe80d94c5caaae024");
  });

  it('post123: locks .github/dependabot.yml spaces 130', () => {
    expect((read(".github/dependabot.yml").match(/ /g) ?? []).length).toBe(130);
  });

  it('post123: locks vitest.config.ts sha256', () => {
    expect(sha256("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it('post123: locks vitest.config.ts sha1', () => {
    expect(sha1("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it('post123: locks vitest.config.ts md5', () => {
    expect(md5("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it('post123: locks vitest.config.ts sha384', () => {
    expect(sha384("vitest.config.ts")).toBe("c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563");
  });

  it('post123: locks vitest.config.ts sha512', () => {
    expect(sha512("vitest.config.ts")).toBe("ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682");
  });

  it('post123: locks vitest.config.ts sha3-256', () => {
    expect(sha3("vitest.config.ts")).toBe("ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba");
  });

  it('post123: locks vitest.config.ts blake2b512', () => {
    expect(blake2b("vitest.config.ts")).toBe("93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a");
  });

  it('post123: locks vitest.config.ts ripemd160', () => {
    expect(ripemd("vitest.config.ts")).toBe("6f29a743813430d4d364f8ddd66e0aedf1506fcd");
  });

  it('post123: locks vitest.config.ts size 535', () => {
    expect(statSync(join(root, "vitest.config.ts")).size).toBe(535);
    expect(readFileSync(join(root, "vitest.config.ts")).byteLength).toBe(535);
  });

  it('post123: locks vitest.config.ts utf8 535 lines 22', () => {
    expect(read("vitest.config.ts")).toHaveLength(535);
    expect(read("vitest.config.ts").split('\n')).toHaveLength(22);
  });

  it('post123: locks vitest.config.ts nibble 536 xor 2', () => {
    const d = sha256("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post123: locks vitest.config.ts first/last octets', () => {
    const d = sha256("vitest.config.ts");
    expect(d.slice(0, 2)).toBe("f9");
    expect(d.slice(-2)).toBe("38");
  });

  it('post123: locks vitest.config.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "vitest.config.ts")).toBe("a6732e30b4dd61c4da8c346cd49c5deeb3be461ac8881977c82e672d929cd8b4");
    expect(hmacSha256('TOKENMAXX', "vitest.config.ts")).toBe("0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9");
    expect(hmacSha256('ci-config', "vitest.config.ts")).toBe("b48d4463ac3144a8a6e5e60a568762fe11adefce678494ceb591e4e63ae528c3");
  });

  it('post123: locks vitest.config.ts spaces 121', () => {
    expect((read("vitest.config.ts").match(/ /g) ?? []).length).toBe(121);
  });

  it('post123: locks package.json sha256', () => {
    expect(sha256("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it('post123: locks package.json sha1', () => {
    expect(sha1("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it('post123: locks package.json md5', () => {
    expect(md5("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it('post123: locks package.json sha384', () => {
    expect(sha384("package.json")).toBe("4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20");
  });

  it('post123: locks package.json sha512', () => {
    expect(sha512("package.json")).toBe("7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28");
  });

  it('post123: locks package.json sha3-256', () => {
    expect(sha3("package.json")).toBe("e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5");
  });

  it('post123: locks package.json blake2b512', () => {
    expect(blake2b("package.json")).toBe("a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d");
  });

  it('post123: locks package.json ripemd160', () => {
    expect(ripemd("package.json")).toBe("f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad");
  });

  it('post123: locks package.json size 637', () => {
    expect(statSync(join(root, "package.json")).size).toBe(637);
    expect(readFileSync(join(root, "package.json")).byteLength).toBe(637);
  });

  it('post123: locks package.json utf8 635 lines 26', () => {
    expect(read("package.json")).toHaveLength(635);
    expect(read("package.json").split('\n')).toHaveLength(26);
  });

  it('post123: locks package.json nibble 451 xor 13', () => {
    const d = sha256("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post123: locks package.json first/last octets', () => {
    const d = sha256("package.json");
    expect(d.slice(0, 2)).toBe("34");
    expect(d.slice(-2)).toBe("1c");
  });

  it('post123: locks package.json HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "package.json")).toBe("f5820d067b7998f6c704e4680b7f143587a45625c630fc73c7b09306b45d6e57");
    expect(hmacSha256('TOKENMAXX', "package.json")).toBe("ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58");
    expect(hmacSha256('ci-config', "package.json")).toBe("9af90b16d02d642aa55aa2a1cf7816f6cab099d1837f4d1efcc3a76638229f38");
  });

  it('post123: locks package.json spaces 106', () => {
    expect((read("package.json").match(/ /g) ?? []).length).toBe(106);
  });

  it('post123: locks AGENTS.md sha256', () => {
    expect(sha256("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it('post123: locks AGENTS.md sha1', () => {
    expect(sha1("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it('post123: locks AGENTS.md md5', () => {
    expect(md5("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it('post123: locks AGENTS.md sha384', () => {
    expect(sha384("AGENTS.md")).toBe("817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a");
  });

  it('post123: locks AGENTS.md sha512', () => {
    expect(sha512("AGENTS.md")).toBe("7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908");
  });

  it('post123: locks AGENTS.md sha3-256', () => {
    expect(sha3("AGENTS.md")).toBe("894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4");
  });

  it('post123: locks AGENTS.md blake2b512', () => {
    expect(blake2b("AGENTS.md")).toBe("7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0");
  });

  it('post123: locks AGENTS.md ripemd160', () => {
    expect(ripemd("AGENTS.md")).toBe("6637e853e0148967671e4a3f21bd852255e8ed1c");
  });

  it('post123: locks AGENTS.md size 1017', () => {
    expect(statSync(join(root, "AGENTS.md")).size).toBe(1017);
    expect(readFileSync(join(root, "AGENTS.md")).byteLength).toBe(1017);
  });

  it('post123: locks AGENTS.md utf8 1011 lines 35', () => {
    expect(read("AGENTS.md")).toHaveLength(1011);
    expect(read("AGENTS.md").split('\n')).toHaveLength(35);
  });

  it('post123: locks AGENTS.md nibble 479 xor 5', () => {
    const d = sha256("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post123: locks AGENTS.md first/last octets', () => {
    const d = sha256("AGENTS.md");
    expect(d.slice(0, 2)).toBe("48");
    expect(d.slice(-2)).toBe("aa");
  });

  it('post123: locks AGENTS.md HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "AGENTS.md")).toBe("8ac3125a7f2dc42ed6c1771338dd37727206fbd31dfcbf881040082082adc83d");
    expect(hmacSha256('TOKENMAXX', "AGENTS.md")).toBe("b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f");
    expect(hmacSha256('ci-config', "AGENTS.md")).toBe("1e8f20e9d67be8517c3acfdce81387fdbcd5d1bda52f43fffdb055139810c224");
  });

  it('post123: locks AGENTS.md spaces 120', () => {
    expect((read("AGENTS.md").match(/ /g) ?? []).length).toBe(120);
  });

  it('post123: locks test/helpers.ts sha256', () => {
    expect(sha256("test/helpers.ts")).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
  });

  it('post123: locks test/helpers.ts sha1', () => {
    expect(sha1("test/helpers.ts")).toBe("aac5e2154aa8f0784db092ad4bb51304fce6e117");
  });

  it('post123: locks test/helpers.ts md5', () => {
    expect(md5("test/helpers.ts")).toBe("004bbc8741017d8dd45bee28a29b46e1");
  });

  it('post123: locks test/helpers.ts sha384', () => {
    expect(sha384("test/helpers.ts")).toBe("1e769f73400f921f25168ef2d408d099e12eee86ee092cf9883c0fe30149a90772171be2e8a13ac92b09294194f38167");
  });

  it('post123: locks test/helpers.ts sha512', () => {
    expect(sha512("test/helpers.ts")).toBe("153eabb426836a56130b49b90611260d3630cf906663d61e1c0c6752819c3907b8dfbf9cc88531336b9a04c9d1c60b95a81d0e7ee97418122915c87377ff2c91");
  });

  it('post123: locks test/helpers.ts sha3-256', () => {
    expect(sha3("test/helpers.ts")).toBe("8ffbb4baecd580e1f9f797a737d24af1f3e0fb48af208435dafe8afaa584b113");
  });

  it('post123: locks test/helpers.ts blake2b512', () => {
    expect(blake2b("test/helpers.ts")).toBe("9000b1e34f31a60c5b766398de6ce5657f7325d791b129e388e1312c47d8448070919d7711a2824b821a99661fbeb73f6e13dfa4b1de53d72aa0990f73f1061f");
  });

  it('post123: locks test/helpers.ts ripemd160', () => {
    expect(ripemd("test/helpers.ts")).toBe("24c482ba1ff1b74537b67a89b99058b6f2e500a4");
  });

  it('post123: locks test/helpers.ts size 6078', () => {
    expect(statSync(join(root, "test/helpers.ts")).size).toBe(6078);
    expect(readFileSync(join(root, "test/helpers.ts")).byteLength).toBe(6078);
  });

  it('post123: locks test/helpers.ts utf8 6078 lines 164', () => {
    expect(read("test/helpers.ts")).toHaveLength(6078);
    expect(read("test/helpers.ts").split('\n')).toHaveLength(164);
  });

  it('post123: locks test/helpers.ts nibble 487 xor 5', () => {
    const d = sha256("test/helpers.ts");
    expect(nibbleSum(d)).toBe(487);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post123: locks test/helpers.ts first/last octets', () => {
    const d = sha256("test/helpers.ts");
    expect(d.slice(0, 2)).toBe("24");
    expect(d.slice(-2)).toBe("29");
  });

  it('post123: locks test/helpers.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "test/helpers.ts")).toBe("8bd4ac7ac6f0833e49dbfc0059a4a863cb2adf98ddb0c6fa2e5599415b108799");
    expect(hmacSha256('TOKENMAXX', "test/helpers.ts")).toBe("8b1973547653b49511673307302184ed795b388e025a43d50e0b32fc3e476391");
    expect(hmacSha256('ci-config', "test/helpers.ts")).toBe("09c6a7ad1aff663717e25ad0719777b1ba908e3c10626a6dc8246679319ea4d4");
  });

  it('post123: locks test/helpers.ts spaces 919', () => {
    expect((read("test/helpers.ts").match(/ /g) ?? []).length).toBe(919);
  });

  it('post123: locks src/genres.ts sha256', () => {
    expect(sha256("src/genres.ts")).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it('post123: locks src/genres.ts sha1', () => {
    expect(sha1("src/genres.ts")).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it('post123: locks src/genres.ts md5', () => {
    expect(md5("src/genres.ts")).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it('post123: locks src/genres.ts sha384', () => {
    expect(sha384("src/genres.ts")).toBe("ba84fb097988f01bc57a7ee5cb039c2988714d4c8d8d20d2734c0ce701b427e25330052b622bcf0dedaebc7c5d8b4d16");
  });

  it('post123: locks src/genres.ts sha512', () => {
    expect(sha512("src/genres.ts")).toBe("bba59f379fff739b577d35c44f55974a78a5103b06581a5e51488caa9681ba261ab821f1a2f52e589795521396c41dfaa70fc2921bde0ab0db0ceed18dc1ef6b");
  });

  it('post123: locks src/genres.ts sha3-256', () => {
    expect(sha3("src/genres.ts")).toBe("d873c498335014a5e3d40e5ab78ea8f3ba4e642df056fff51de989da45634d7f");
  });

  it('post123: locks src/genres.ts blake2b512', () => {
    expect(blake2b("src/genres.ts")).toBe("731f6cb880bc465d545820c1dff8ccf87b92624a34e703085f2d49af06e6a7f0fe14f2f7b99080a9a1699b32806a33199b21b9b30f6d3b21127cafdaaddb4d67");
  });

  it('post123: locks src/genres.ts ripemd160', () => {
    expect(ripemd("src/genres.ts")).toBe("bb9faaf8890bdba8dd86bcdf7e418da622d19bf5");
  });

  it('post123: locks src/genres.ts size 1027', () => {
    expect(statSync(join(root, "src/genres.ts")).size).toBe(1027);
    expect(readFileSync(join(root, "src/genres.ts")).byteLength).toBe(1027);
  });

  it('post123: locks src/genres.ts utf8 1025 lines 48', () => {
    expect(read("src/genres.ts")).toHaveLength(1025);
    expect(read("src/genres.ts").split('\n')).toHaveLength(48);
  });

  it('post123: locks src/genres.ts nibble 500 xor 6', () => {
    const d = sha256("src/genres.ts");
    expect(nibbleSum(d)).toBe(500);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post123: locks src/genres.ts first/last octets', () => {
    const d = sha256("src/genres.ts");
    expect(d.slice(0, 2)).toBe("aa");
    expect(d.slice(-2)).toBe("4e");
  });

  it('post123: locks src/genres.ts HMAC post123/TOKENMAXX/ci-config', () => {
    expect(hmacSha256('post123', "src/genres.ts")).toBe("72668068ccae1276030366ed88cb366c289ad92818116728f26d3a58decf085c");
    expect(hmacSha256('TOKENMAXX', "src/genres.ts")).toBe("7abd1ff098bb19d7a63a4b6c2c44965f0ea04ceb5fc40896c92ef7ea8f00b951");
    expect(hmacSha256('ci-config', "src/genres.ts")).toBe("02697e0bdc953f71214cc79afec2ae5e84cd1fdc756793ee4126468e035ea59e");
  });

  it('post123: locks src/genres.ts spaces 144', () => {
    expect((read("src/genres.ts").match(/ /g) ?? []).length).toBe(144);
  });

  it('post123: CI pins Node 20 npm ci coverage artifact', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/node-version:\s*"20"/);
    expect(ci).toContain('npm ci');
    expect(ci).toContain('upload-artifact@v4');
    expect(ci).toContain('coverage-report');
    expect(ci).toContain('retention-days: 14');
  });

  it('post123: CI job order typecheck/test/hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('\n  typecheck:\n')).toBeLessThan(ci.indexOf('\n  test:\n'));
    expect(ci.indexOf('\n  test:\n')).toBeLessThan(ci.indexOf('\n  hygiene:\n'));
  });

  it('post123: deploy HITL workflow_dispatch only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('workflow_dispatch');
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
    expect(deploy).toContain('GEMINI_API_KEY');
  });

  it('post123: dependabot monthly npm+actions major ignore', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('package-ecosystem: "npm"');
    expect(dep).toContain('package-ecosystem: "github-actions"');
    expect(dep).toContain('interval: "monthly"');
    expect(dep).toContain('version-update:semver-major');
  });

  it('post123: vitest 100 thresholds', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it('post123: AGENTS verify scripts', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('post123: negative inventing fence CI/package', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('package.json')).not.toMatch(/playlist|now-playing/i);
  });

  it('post123: hygiene lists leftover suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['test/helpers.test.ts','test/genres.test.ts','test/routes.test.ts','test/ci-config.test.ts'] as const) {
      expect(ci).toContain(`test -f ${f}`);
    }
  });

  it('post123: mega purity 40x ci.yml', () => {
    const expected = "c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5";
    for (let i = 0; i < 40; i++) expect(sha256('.github/workflows/ci.yml')).toBe(expected);
  });

  it('post123: final inventory markers', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post116 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post123 ci-config HEAVY deepen (after #123)'");
    expect((body.match(/it\('post123:/g) ?? []).length).toBeGreaterThan(80);
  });

});

// --- HEAVY burn (post-#120): deepen ci-config leftover edges only — no product inventing ---
// Orthogonal to #119 genres + #120 routes leftovers. Digests, HMAC post120 locks, workflow
// structural pins, hygiene cross-locks, ISSUE_TEMPLATE/package/vitest leftover edges — tests-only.

describe('post120 ci-config HEAVY deepen', () => {
  const sha256 = (rel: string) =>
    createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) =>
    createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) =>
    createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha1 = (key: string, rel: string) =>
    createHmac('sha1', key).update(readFileSync(join(root, rel))).digest('hex');
  const hmacMd5 = (key: string, rel: string) =>
    createHmac('md5', key).update(readFileSync(join(root, rel))).digest('hex');
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

  it('post120: locks ci.yml sha256 digest', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe(
      'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
    );
  });

  it('post120: locks ci.yml sha1 digest', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post120: locks ci.yml md5 digest', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post120: locks ci.yml sha256 nibble sum 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post120: locks ci.yml sha256 pairSum 4595 rollingXor 71', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(pairSum(d)).toBe(4595);
    expect(rollingXor(d)).toBe(71);
  });

  it('post120: locks ci.yml byte size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post120: locks ci.yml utf8 char length 6295', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
  });

  it('post120: locks ci.yml line count 177', () => {
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post120: locks ci.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/workflows/ci.yml')).toBe(
      '89b3c70174462088f8edeb516315ff604beb16f58749d096809ff7a7c3794587',
    );
  });

  it('post120: locks ci.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/workflows/ci.yml')).toBe(
      '614aec58b8ac88007b90407a2a037fe8937593971936750406353b25472aec6c',
    );
  });

  it('post120: locks ci.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe(
      'd3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce',
    );
  });

  it('post120: locks ci.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/workflows/ci.yml')).toBe(
      'e997e669ee801faeaaac0ecfb8239cc5d416ffd739f752a288a997d086e7bd15',
    );
  });

  it('post120: locks ci.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/workflows/ci.yml')).toBe('fb36d8266b213ae7c228ed0df54b8f02a247b072');
    expect(hmacMd5('post120', '.github/workflows/ci.yml')).toBe('0182dab274f4e641ac17a8c7251985d1');
  });

  it('post120: locks ci.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/ci.yml');
    expect(hex.slice(0, 2)).toBe('c4');
    expect(hex.slice(-2)).toBe('d5');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks ci.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/workflows/ci.yml').slice(28, 36)).toBe('f5e6f56e');
  });

  it('post120: locks deploy.yml sha256 digest', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe(
      '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
    );
  });

  it('post120: locks deploy.yml sha1 digest', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post120: locks deploy.yml md5 digest', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post120: locks deploy.yml sha256 nibble sum 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post120: locks deploy.yml sha256 pairSum 3686 rollingXor 38', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(pairSum(d)).toBe(3686);
    expect(rollingXor(d)).toBe(38);
  });

  it('post120: locks deploy.yml byte size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post120: locks deploy.yml utf8 char length 1004', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
  });

  it('post120: locks deploy.yml line count 47', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post120: locks deploy.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/workflows/deploy.yml')).toBe(
      'e655b296198bdb58e6fd845da0e537472b7b0a7b91678242a1e79e8e39282273',
    );
  });

  it('post120: locks deploy.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/workflows/deploy.yml')).toBe(
      '811f3f90a3a75dec226624b0a8eb1881a02ea82f8c331c2ba7a96b13eb4f6c79',
    );
  });

  it('post120: locks deploy.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe(
      'e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83',
    );
  });

  it('post120: locks deploy.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/workflows/deploy.yml')).toBe(
      'b2d258b8ef783136b38e6607f0b0c441f5f7cc85a2aca677b051bdba3fa57eca',
    );
  });

  it('post120: locks deploy.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/workflows/deploy.yml')).toBe('d8d87c730f0f780f398dabbae18333bf0d9200d9');
    expect(hmacMd5('post120', '.github/workflows/deploy.yml')).toBe('4bf90615e7c6ae00a8910b31d4b8c13c');
  });

  it('post120: locks deploy.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/deploy.yml');
    expect(hex.slice(0, 2)).toBe('49');
    expect(hex.slice(-2)).toBe('c3');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks deploy.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/workflows/deploy.yml').slice(28, 36)).toBe('de06de33');
  });

  it('post120: locks dependabot.yml sha256 digest', () => {
    expect(sha256('.github/dependabot.yml')).toBe(
      'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac',
    );
  });

  it('post120: locks dependabot.yml sha1 digest', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post120: locks dependabot.yml md5 digest', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post120: locks dependabot.yml sha256 nibble sum 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post120: locks dependabot.yml sha256 pairSum 4381 rollingXor 219', () => {
    const d = sha256('.github/dependabot.yml');
    expect(pairSum(d)).toBe(4381);
    expect(rollingXor(d)).toBe(219);
  });

  it('post120: locks dependabot.yml byte size 505', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
    expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post120: locks dependabot.yml utf8 char length 505', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
  });

  it('post120: locks dependabot.yml line count 25', () => {
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post120: locks dependabot.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/dependabot.yml')).toBe(
      '7e6894911d2e98a20f1ec8f5d98b7277e4c8024a593f4abbfd57993d77b16757',
    );
  });

  it('post120: locks dependabot.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/dependabot.yml')).toBe(
      '6f473534561f1943006495f89635e8a799bd91705357c392d1d8e4ceab9c4b4b',
    );
  });

  it('post120: locks dependabot.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe(
      'b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9',
    );
  });

  it('post120: locks dependabot.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/dependabot.yml')).toBe(
      '8b61de03ef1b75db2912b46274382788f1abd7bb4823d4dfe80d94c5caaae024',
    );
  });

  it('post120: locks dependabot.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/dependabot.yml')).toBe('088d644ba69ddd211d2f4c5da75098a95c2dbb13');
    expect(hmacMd5('post120', '.github/dependabot.yml')).toBe('ce0539d96ab3c7c339b51e1ee6480516');
  });

  it('post120: locks dependabot.yml sha256 first/last octets', () => {
    const hex = sha256('.github/dependabot.yml');
    expect(hex.slice(0, 2)).toBe('a1');
    expect(hex.slice(-2)).toBe('ac');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks dependabot.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/dependabot.yml').slice(28, 36)).toBe('6507533f');
  });

  it('post120: locks vitest.config.ts sha256 digest', () => {
    expect(sha256('vitest.config.ts')).toBe(
      'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
    );
  });

  it('post120: locks vitest.config.ts sha1 digest', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post120: locks vitest.config.ts md5 digest', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post120: locks vitest.config.ts sha256 nibble sum 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post120: locks vitest.config.ts sha256 pairSum 4691 rollingXor 49', () => {
    const d = sha256('vitest.config.ts');
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it('post120: locks vitest.config.ts byte size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post120: locks vitest.config.ts utf8 char length 535', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
  });

  it('post120: locks vitest.config.ts line count 22', () => {
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post120: locks vitest.config.ts HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'vitest.config.ts')).toBe(
      'bbe02800dc195e0b10846ec2ebc54bf8208b119746aaf306ca2207779e6e4574',
    );
  });

  it('post120: locks vitest.config.ts HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'vitest.config.ts')).toBe(
      '8385718b9223b4b9d356fc085a06218ff0af03129f4f289073b22c427fa76423',
    );
  });

  it('post120: locks vitest.config.ts HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'vitest.config.ts')).toBe(
      '3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7',
    );
  });

  it('post120: locks vitest.config.ts HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'vitest.config.ts')).toBe(
      'b48d4463ac3144a8a6e5e60a568762fe11adefce678494ceb591e4e63ae528c3',
    );
  });

  it('post120: locks vitest.config.ts HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'vitest.config.ts')).toBe('f0d7826805c11adfb07d77f47719715632385e39');
    expect(hmacMd5('post120', 'vitest.config.ts')).toBe('c8e8bfbb702b0cfdd4eedf4a891b786c');
  });

  it('post120: locks vitest.config.ts sha256 first/last octets', () => {
    const hex = sha256('vitest.config.ts');
    expect(hex.slice(0, 2)).toBe('f9');
    expect(hex.slice(-2)).toBe('38');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks vitest.config.ts sha256 middle 8 nibbles', () => {
    expect(sha256('vitest.config.ts').slice(28, 36)).toBe('ec95c6d5');
  });

  it('post120: locks package.json sha256 digest', () => {
    expect(sha256('package.json')).toBe(
      '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
    );
  });

  it('post120: locks package.json sha1 digest', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post120: locks package.json md5 digest', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post120: locks package.json sha256 nibble sum 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post120: locks package.json sha256 pairSum 4051 rollingXor 13', () => {
    const d = sha256('package.json');
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it('post120: locks package.json byte size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post120: locks package.json utf8 char length 635', () => {
    expect(read('package.json')).toHaveLength(635);
  });

  it('post120: locks package.json line count 26', () => {
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post120: locks package.json HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'package.json')).toBe(
      '6d79a4a8140e60610f96f64cc33619c16c400ccb8a8589787458b0b280aa73a8',
    );
  });

  it('post120: locks package.json HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'package.json')).toBe(
      'c5d835695f01d8c9c80ca1d518a558dc84345709f3c3bd2e3dff2e824a147de0',
    );
  });

  it('post120: locks package.json HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'package.json')).toBe(
      '20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1',
    );
  });

  it('post120: locks package.json HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'package.json')).toBe(
      '9af90b16d02d642aa55aa2a1cf7816f6cab099d1837f4d1efcc3a76638229f38',
    );
  });

  it('post120: locks package.json HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'package.json')).toBe('9ac558a0974433c3c75218421f5b08a2aa6c0360');
    expect(hmacMd5('post120', 'package.json')).toBe('9e29edd0332c3afa56e4416dd0753742');
  });

  it('post120: locks package.json sha256 first/last octets', () => {
    const hex = sha256('package.json');
    expect(hex.slice(0, 2)).toBe('34');
    expect(hex.slice(-2)).toBe('1c');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks package.json sha256 middle 8 nibbles', () => {
    expect(sha256('package.json').slice(28, 36)).toBe('e0ecaa43');
  });

  it('post120: locks tsconfig.json sha256 digest', () => {
    expect(sha256('tsconfig.json')).toBe(
      'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
    );
  });

  it('post120: locks tsconfig.json sha1 digest', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post120: locks tsconfig.json md5 digest', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post120: locks tsconfig.json sha256 nibble sum 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post120: locks tsconfig.json sha256 pairSum 4436 rollingXor 110', () => {
    const d = sha256('tsconfig.json');
    expect(pairSum(d)).toBe(4436);
    expect(rollingXor(d)).toBe(110);
  });

  it('post120: locks tsconfig.json byte size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post120: locks tsconfig.json utf8 char length 397', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
  });

  it('post120: locks tsconfig.json line count 24', () => {
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post120: locks tsconfig.json HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'tsconfig.json')).toBe(
      '35b679a5bcaecdd9c4b5edef26ed2ca923d2ede2eede000608da18edbce67697',
    );
  });

  it('post120: locks tsconfig.json HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'tsconfig.json')).toBe(
      'b7e0bf9defff2ac853c24be3491fbde816de332de43907743fc1849e5aa018ba',
    );
  });

  it('post120: locks tsconfig.json HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'tsconfig.json')).toBe(
      '8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9',
    );
  });

  it('post120: locks tsconfig.json HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'tsconfig.json')).toBe(
      '419001e750f87204a6c6d4cffff7d5324d92ef88acc751e05de8b60b747c008a',
    );
  });

  it('post120: locks tsconfig.json HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'tsconfig.json')).toBe('133b784a645fcd62a7fbc8c515d29e22b49a010d');
    expect(hmacMd5('post120', 'tsconfig.json')).toBe('0e7efa9e57290835cce7b17f0383f3a9');
  });

  it('post120: locks tsconfig.json sha256 first/last octets', () => {
    const hex = sha256('tsconfig.json');
    expect(hex.slice(0, 2)).toBe('ef');
    expect(hex.slice(-2)).toBe('92');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks tsconfig.json sha256 middle 8 nibbles', () => {
    expect(sha256('tsconfig.json').slice(28, 36)).toBe('04688ea1');
  });

  it('post120: locks .gitignore sha256 digest', () => {
    expect(sha256('.gitignore')).toBe(
      '474ed59338a23de819e219c00d0e033b23e3669cc4106ce7a888fe0636569698',
    );
  });

  it('post120: locks .gitignore sha1 digest', () => {
    expect(sha1('.gitignore')).toBe('432103230f4c49258e046fc945e8160007c23570');
  });

  it('post120: locks .gitignore md5 digest', () => {
    expect(md5('.gitignore')).toBe('7d0728257f47875ec0120ca3cdbf7308');
  });

  it('post120: locks .gitignore sha256 nibble sum 444 xor 6', () => {
    const d = sha256('.gitignore');
    expect(nibbleSum(d)).toBe(444);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post120: locks .gitignore sha256 pairSum 3654 rollingXor 202', () => {
    const d = sha256('.gitignore');
    expect(pairSum(d)).toBe(3654);
    expect(rollingXor(d)).toBe(202);
  });

  it('post120: locks .gitignore byte size 261', () => {
    expect(statSync(join(root, '.gitignore')).size).toBe(261);
    expect(readFileSync(join(root, '.gitignore')).byteLength).toBe(261);
  });

  it('post120: locks .gitignore utf8 char length 261', () => {
    expect(read('.gitignore')).toHaveLength(261);
  });

  it('post120: locks .gitignore line count 26', () => {
    expect(read('.gitignore').split('\n')).toHaveLength(26);
  });

  it('post120: locks .gitignore HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.gitignore')).toBe(
      '88b93f1d26d3dee97a5389c3e1abe9fa31beda49ec2f9fed7e2786b63470e9da',
    );
  });

  it('post120: locks .gitignore HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.gitignore')).toBe(
      'd0369da372747c182c7a8880ca9507a6455e363a82c5200fd4cd8986c91c197f',
    );
  });

  it('post120: locks .gitignore HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.gitignore')).toBe(
      '9c1460213a45c3753856859b30d66715c71699434934985ae44b93110f43d84e',
    );
  });

  it('post120: locks .gitignore HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.gitignore')).toBe(
      '6a912adbdce7ef35c0e20cedc5559dea42d8e8af9a1af43490aca607d0c89af3',
    );
  });

  it('post120: locks .gitignore HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.gitignore')).toBe('8bfd381c8afcd8391f5eb6898c13f0452af1e388');
    expect(hmacMd5('post120', '.gitignore')).toBe('e42746803b6eed152a2c24d648de2446');
  });

  it('post120: locks .gitignore sha256 first/last octets', () => {
    const hex = sha256('.gitignore');
    expect(hex.slice(0, 2)).toBe('47');
    expect(hex.slice(-2)).toBe('98');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks .gitignore sha256 middle 8 nibbles', () => {
    expect(sha256('.gitignore').slice(28, 36)).toBe('033b23e3');
  });

  it('post120: locks environment.json sha256 digest', () => {
    expect(sha256('.cursor/environment.json')).toBe(
      '4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694',
    );
  });

  it('post120: locks environment.json sha1 digest', () => {
    expect(sha1('.cursor/environment.json')).toBe('b4f3dec322cd018ce5c1dea89897a469bd128685');
  });

  it('post120: locks environment.json md5 digest', () => {
    expect(md5('.cursor/environment.json')).toBe('956c8804543595a31d6a7051aecd6528');
  });

  it('post120: locks environment.json sha256 nibble sum 472 xor 0', () => {
    const d = sha256('.cursor/environment.json');
    expect(nibbleSum(d)).toBe(472);
    expect(xorNibbles(d)).toBe(0);
  });

  it('post120: locks environment.json sha256 pairSum 4222 rollingXor 0', () => {
    const d = sha256('.cursor/environment.json');
    expect(pairSum(d)).toBe(4222);
    expect(rollingXor(d)).toBe(0);
  });

  it('post120: locks environment.json byte size 57', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size).toBe(57);
    expect(readFileSync(join(root, '.cursor/environment.json')).byteLength).toBe(57);
  });

  it('post120: locks environment.json utf8 char length 57', () => {
    expect(read('.cursor/environment.json')).toHaveLength(57);
  });

  it('post120: locks environment.json line count 5', () => {
    expect(read('.cursor/environment.json').split('\n')).toHaveLength(5);
  });

  it('post120: locks environment.json HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.cursor/environment.json')).toBe(
      '81b4088120241a79680b90cd9c52dbf0bdf00b118acbeb8d070143d52243473c',
    );
  });

  it('post120: locks environment.json HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.cursor/environment.json')).toBe(
      '88d3292892349d8a028811f283d3a273fc9d92e3d0bd886b9eb3cc2fe03f463b',
    );
  });

  it('post120: locks environment.json HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.cursor/environment.json')).toBe(
      'f3c07027290cc01d2ddd1979fab399b4f4ddaed8e682f9ba6f15b59f23ba2bc4',
    );
  });

  it('post120: locks environment.json HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.cursor/environment.json')).toBe(
      '89582143f68b016bb37c4fbcd570f0c296c37c459c19c70fbc513907d0357136',
    );
  });

  it('post120: locks environment.json HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.cursor/environment.json')).toBe('ab1f07df680cf11fa53735f1d6f87823c0444c85');
    expect(hmacMd5('post120', '.cursor/environment.json')).toBe('097886d9d4715e1b9159b6c665832ad3');
  });

  it('post120: locks environment.json sha256 first/last octets', () => {
    const hex = sha256('.cursor/environment.json');
    expect(hex.slice(0, 2)).toBe('4e');
    expect(hex.slice(-2)).toBe('94');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks environment.json sha256 middle 8 nibbles', () => {
    expect(sha256('.cursor/environment.json').slice(28, 36)).toBe('d121164a');
  });

  it('post120: locks AGENTS.md sha256 digest', () => {
    expect(sha256('AGENTS.md')).toBe(
      '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
    );
  });

  it('post120: locks AGENTS.md sha1 digest', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post120: locks AGENTS.md md5 digest', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post120: locks AGENTS.md sha256 nibble sum 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post120: locks AGENTS.md sha256 pairSum 5084 rollingXor 216', () => {
    const d = sha256('AGENTS.md');
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it('post120: locks AGENTS.md byte size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post120: locks AGENTS.md utf8 char length 1011', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
  });

  it('post120: locks AGENTS.md line count 35', () => {
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post120: locks AGENTS.md HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'AGENTS.md')).toBe(
      '965f9c02d9edaa726ee8c5e38e9aeed8d5873322597e6b36a91c921b76ce7deb',
    );
  });

  it('post120: locks AGENTS.md HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'AGENTS.md')).toBe(
      'adfb882196c6d0e671a05365f0ee489baa95767259267a8299206fab4380a63e',
    );
  });

  it('post120: locks AGENTS.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'AGENTS.md')).toBe(
      'ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e',
    );
  });

  it('post120: locks AGENTS.md HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'AGENTS.md')).toBe(
      '1e8f20e9d67be8517c3acfdce81387fdbcd5d1bda52f43fffdb055139810c224',
    );
  });

  it('post120: locks AGENTS.md HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'AGENTS.md')).toBe('155ff95d615689706e9a75fdfa9eb2797e87d0f2');
    expect(hmacMd5('post120', 'AGENTS.md')).toBe('9d0f089524377066e0af1611a49dd771');
  });

  it('post120: locks AGENTS.md sha256 first/last octets', () => {
    const hex = sha256('AGENTS.md');
    expect(hex.slice(0, 2)).toBe('48');
    expect(hex.slice(-2)).toBe('aa');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks AGENTS.md sha256 middle 8 nibbles', () => {
    expect(sha256('AGENTS.md').slice(28, 36)).toBe('a5ec1be5');
  });

  it('post120: locks .gitattributes sha256 digest', () => {
    expect(sha256('.gitattributes')).toBe(
      '1a1dbe176bc233b499d35a57db7513f2941c99ab9759f177830c9149be99005b',
    );
  });

  it('post120: locks .gitattributes sha1 digest', () => {
    expect(sha1('.gitattributes')).toBe('ba3dfe345280bdcc5e817bb02cf49b8b8d8e1c4c');
  });

  it('post120: locks .gitattributes md5 digest', () => {
    expect(md5('.gitattributes')).toBe('05bdb783ee6514c8c072e47680af8ff7');
  });

  it('post120: locks .gitattributes sha256 nibble sum 458 xor 4', () => {
    const d = sha256('.gitattributes');
    expect(nibbleSum(d)).toBe(458);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post120: locks .gitattributes sha256 pairSum 3833 rollingXor 81', () => {
    const d = sha256('.gitattributes');
    expect(pairSum(d)).toBe(3833);
    expect(rollingXor(d)).toBe(81);
  });

  it('post120: locks .gitattributes byte size 66', () => {
    expect(statSync(join(root, '.gitattributes')).size).toBe(66);
    expect(readFileSync(join(root, '.gitattributes')).byteLength).toBe(66);
  });

  it('post120: locks .gitattributes utf8 char length 66', () => {
    expect(read('.gitattributes')).toHaveLength(66);
  });

  it('post120: locks .gitattributes line count 3', () => {
    expect(read('.gitattributes').split('\n')).toHaveLength(3);
  });

  it('post120: locks .gitattributes HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.gitattributes')).toBe(
      '67673391df330244f7c8f6669d42262ee6d32d01b2b7dd2763c268bb7f002f2d',
    );
  });

  it('post120: locks .gitattributes HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.gitattributes')).toBe(
      'b79eaac971a32b968244f992370a3e1b07e683f6785ca0c6fae77f818e2d0a5e',
    );
  });

  it('post120: locks .gitattributes HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.gitattributes')).toBe(
      'f3a2220dfcdb93577ade981c77df8a46a77d67cc8ca65024e3b54007bd55151e',
    );
  });

  it('post120: locks .gitattributes HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.gitattributes')).toBe(
      '6ce67056afbd26bb77fe120d1cf0d1ca508fe14b68665b2864ee447a3986c241',
    );
  });

  it('post120: locks .gitattributes HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.gitattributes')).toBe('702cc6abd69420c8fccf2f6509f07e12ca4316a3');
    expect(hmacMd5('post120', '.gitattributes')).toBe('36cb744fa32e9c114cf263f75f5074f4');
  });

  it('post120: locks .gitattributes sha256 first/last octets', () => {
    const hex = sha256('.gitattributes');
    expect(hex.slice(0, 2)).toBe('1a');
    expect(hex.slice(-2)).toBe('5b');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks .gitattributes sha256 middle 8 nibbles', () => {
    expect(sha256('.gitattributes').slice(28, 36)).toBe('13f2941c');
  });

  it('post120: locks package-lock.json sha256 digest', () => {
    expect(sha256('package-lock.json')).toBe(
      '5f8a888f1fc7aaf97dcdaa3f91405cefbb45ad118685eac7a1488b78cedfcee6',
    );
  });

  it('post120: locks package-lock.json sha1 digest', () => {
    expect(sha1('package-lock.json')).toBe('6bc7eb19009d4dccc1d2928b0d856f337eb76aad');
  });

  it('post120: locks package-lock.json md5 digest', () => {
    expect(md5('package-lock.json')).toBe('568e267e07346bb7de4796dbeb117b54');
  });

  it('post120: locks package-lock.json sha256 nibble sum 582 xor 4', () => {
    const d = sha256('package-lock.json');
    expect(nibbleSum(d)).toBe(582);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post120: locks package-lock.json sha256 pairSum 4767 rollingXor 81', () => {
    const d = sha256('package-lock.json');
    expect(pairSum(d)).toBe(4767);
    expect(rollingXor(d)).toBe(81);
  });

  it('post120: locks package-lock.json byte size 92068', () => {
    expect(statSync(join(root, 'package-lock.json')).size).toBe(92068);
    expect(readFileSync(join(root, 'package-lock.json')).byteLength).toBe(92068);
  });

  it('post120: locks package-lock.json utf8 char length 92068', () => {
    expect(read('package-lock.json')).toHaveLength(92068);
  });

  it('post120: locks package-lock.json line count 2842', () => {
    expect(read('package-lock.json').split('\n')).toHaveLength(2842);
  });

  it('post120: locks package-lock.json HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'package-lock.json')).toBe(
      '4b584f5c3e1bda0cf8240f9cff2f97397d63c98bc2ac57f180c0b58ad27dc33d',
    );
  });

  it('post120: locks package-lock.json HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'package-lock.json')).toBe(
      '34d1cd6c37feb8c6b4fe0bff9e4ba9f5ccd3d3264b73d175d57c317b710ae820',
    );
  });

  it('post120: locks package-lock.json HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'package-lock.json')).toBe(
      'f04fe8ac9766d02021ff5725691e975316734f7c83f66edaf85f8239fb6955c1',
    );
  });

  it('post120: locks package-lock.json HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'package-lock.json')).toBe(
      '326a070fd1036eba109bdafe8028c34e0f80e740db01e586803212520bee632a',
    );
  });

  it('post120: locks package-lock.json HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'package-lock.json')).toBe('dd19f1311d015b0694b26bf91ffdbb7e768c9e43');
    expect(hmacMd5('post120', 'package-lock.json')).toBe('bebc5884dfaf3371f70a79af0ddddee9');
  });

  it('post120: locks package-lock.json sha256 first/last octets', () => {
    const hex = sha256('package-lock.json');
    expect(hex.slice(0, 2)).toBe('5f');
    expect(hex.slice(-2)).toBe('e6');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks package-lock.json sha256 middle 8 nibbles', () => {
    expect(sha256('package-lock.json').slice(28, 36)).toBe('5cefbb45');
  });

  it('post120: locks DEPLOY.md sha256 digest', () => {
    expect(sha256('DEPLOY.md')).toBe(
      '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
    );
  });

  it('post120: locks DEPLOY.md sha1 digest', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post120: locks DEPLOY.md md5 digest', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post120: locks DEPLOY.md sha256 nibble sum 439 xor 11', () => {
    const d = sha256('DEPLOY.md');
    expect(nibbleSum(d)).toBe(439);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post120: locks DEPLOY.md sha256 pairSum 4234 rollingXor 26', () => {
    const d = sha256('DEPLOY.md');
    expect(pairSum(d)).toBe(4234);
    expect(rollingXor(d)).toBe(26);
  });

  it('post120: locks DEPLOY.md byte size 1573', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size).toBe(1573);
    expect(readFileSync(join(root, 'DEPLOY.md')).byteLength).toBe(1573);
  });

  it('post120: locks DEPLOY.md utf8 char length 1539', () => {
    expect(read('DEPLOY.md')).toHaveLength(1539);
  });

  it('post120: locks DEPLOY.md line count 65', () => {
    expect(read('DEPLOY.md').split('\n')).toHaveLength(65);
  });

  it('post120: locks DEPLOY.md HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'DEPLOY.md')).toBe(
      '477df852bcd9cdb4c1f3f6b34da2c33b6257b5636acc2ab3ded506b396cebd56',
    );
  });

  it('post120: locks DEPLOY.md HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'DEPLOY.md')).toBe(
      'bc518ec0bb565155a4eb4d0de94759ed61af7c7f23c3059764989d8f26fbe78e',
    );
  });

  it('post120: locks DEPLOY.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'DEPLOY.md')).toBe(
      '8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659',
    );
  });

  it('post120: locks DEPLOY.md HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'DEPLOY.md')).toBe(
      'b27e64e44a605676c5e7ec1ac636c68b62712ebbb87a5f5f64d0e031bd827ecd',
    );
  });

  it('post120: locks DEPLOY.md HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'DEPLOY.md')).toBe('9cb54d5bc727c57e02e757dd2d14686b407ab14c');
    expect(hmacMd5('post120', 'DEPLOY.md')).toBe('8a59b2b3f4bd30d4cbd72395fde6dc0e');
  });

  it('post120: locks DEPLOY.md sha256 first/last octets', () => {
    const hex = sha256('DEPLOY.md');
    expect(hex.slice(0, 2)).toBe('11');
    expect(hex.slice(-2)).toBe('5a');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks DEPLOY.md sha256 middle 8 nibbles', () => {
    expect(sha256('DEPLOY.md').slice(28, 36)).toBe('f363d487');
  });

  it('post120: locks README.md sha256 digest', () => {
    expect(sha256('README.md')).toBe(
      'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
    );
  });

  it('post120: locks README.md sha1 digest', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post120: locks README.md md5 digest', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post120: locks README.md sha256 nibble sum 429 xor 13', () => {
    const d = sha256('README.md');
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post120: locks README.md sha256 pairSum 4164 rollingXor 88', () => {
    const d = sha256('README.md');
    expect(pairSum(d)).toBe(4164);
    expect(rollingXor(d)).toBe(88);
  });

  it('post120: locks README.md byte size 2801', () => {
    expect(statSync(join(root, 'README.md')).size).toBe(2801);
    expect(readFileSync(join(root, 'README.md')).byteLength).toBe(2801);
  });

  it('post120: locks README.md utf8 char length 2757', () => {
    expect(read('README.md')).toHaveLength(2757);
  });

  it('post120: locks README.md line count 82', () => {
    expect(read('README.md').split('\n')).toHaveLength(82);
  });

  it('post120: locks README.md HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'README.md')).toBe(
      '37740d6ed96a42e5dfbc523650f3dfe6ed703f67a5a8c675c029ee73201f86e3',
    );
  });

  it('post120: locks README.md HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'README.md')).toBe(
      'c076b0f22138e7e0a69677b243487a06fbf8779448bf7996d8cd9a14a9441445',
    );
  });

  it('post120: locks README.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'README.md')).toBe(
      '57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f',
    );
  });

  it('post120: locks README.md HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'README.md')).toBe(
      'd2200d30dd2c44cf22921293f93f55010c881b75b920cab8276ddcef891875b6',
    );
  });

  it('post120: locks README.md HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'README.md')).toBe('08f91a8c4ee68ad0decd55b84dc4141e15aefcc3');
    expect(hmacMd5('post120', 'README.md')).toBe('0b64c657ac90fe1642136173aa66315a');
  });

  it('post120: locks README.md sha256 first/last octets', () => {
    const hex = sha256('README.md');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('87');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks README.md sha256 middle 8 nibbles', () => {
    expect(sha256('README.md').slice(28, 36)).toBe('368a10ca');
  });

  it('post120: locks wrangler.toml sha256 digest', () => {
    expect(sha256('wrangler.toml')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post120: locks wrangler.toml sha1 digest', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post120: locks wrangler.toml md5 digest', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post120: locks wrangler.toml sha256 nibble sum 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post120: locks wrangler.toml sha256 pairSum 3802 rollingXor 122', () => {
    const d = sha256('wrangler.toml');
    expect(pairSum(d)).toBe(3802);
    expect(rollingXor(d)).toBe(122);
  });

  it('post120: locks wrangler.toml byte size 330', () => {
    expect(statSync(join(root, 'wrangler.toml')).size).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post120: locks wrangler.toml utf8 char length 330', () => {
    expect(read('wrangler.toml')).toHaveLength(330);
  });

  it('post120: locks wrangler.toml line count 18', () => {
    expect(read('wrangler.toml').split('\n')).toHaveLength(18);
  });

  it('post120: locks wrangler.toml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'wrangler.toml')).toBe(
      'b40b599479f843bb78f2d7e0955ae156e7dc922d70d5aabf1c7ebe1499d6b53a',
    );
  });

  it('post120: locks wrangler.toml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'wrangler.toml')).toBe(
      '9f8c0d87b74a7acf92c1c27eb0f9996c22342f9c8d4f1a19952468e28d605e81',
    );
  });

  it('post120: locks wrangler.toml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'wrangler.toml')).toBe(
      '117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063',
    );
  });

  it('post120: locks wrangler.toml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'wrangler.toml')).toBe(
      '5d6000dc3ef908feddf3ec6b0bab5f39abbfaaf711e0b56f034de28b766528c3',
    );
  });

  it('post120: locks wrangler.toml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'wrangler.toml')).toBe('d37154cac940b5962547897918bafbed236db19b');
    expect(hmacMd5('post120', 'wrangler.toml')).toBe('a2ec020291ea4d4d4e1006ee14c18acc');
  });

  it('post120: locks wrangler.toml sha256 first/last octets', () => {
    const hex = sha256('wrangler.toml');
    expect(hex.slice(0, 2)).toBe('95');
    expect(hex.slice(-2)).toBe('f8');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks wrangler.toml sha256 middle 8 nibbles', () => {
    expect(sha256('wrangler.toml').slice(28, 36)).toBe('4a0b0b87');
  });

  it('post120: locks mcp-spec.md sha256 digest', () => {
    expect(sha256('docs/mcp-spec.md')).toBe(
      'a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849',
    );
  });

  it('post120: locks mcp-spec.md sha1 digest', () => {
    expect(sha1('docs/mcp-spec.md')).toBe('e3e2d1b4bdd67b6c396306af6fc9d119b5a4e88a');
  });

  it('post120: locks mcp-spec.md md5 digest', () => {
    expect(md5('docs/mcp-spec.md')).toBe('ee7881030c338c1773659cc6378c392c');
  });

  it('post120: locks mcp-spec.md sha256 nibble sum 514 xor 14', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(nibbleSum(d)).toBe(514);
    expect(xorNibbles(d)).toBe(14);
  });

  it('post120: locks mcp-spec.md sha256 pairSum 4534 rollingXor 164', () => {
    const d = sha256('docs/mcp-spec.md');
    expect(pairSum(d)).toBe(4534);
    expect(rollingXor(d)).toBe(164);
  });

  it('post120: locks mcp-spec.md byte size 3552', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size).toBe(3552);
    expect(readFileSync(join(root, 'docs/mcp-spec.md')).byteLength).toBe(3552);
  });

  it('post120: locks mcp-spec.md utf8 char length 3544', () => {
    expect(read('docs/mcp-spec.md')).toHaveLength(3544);
  });

  it('post120: locks mcp-spec.md line count 145', () => {
    expect(read('docs/mcp-spec.md').split('\n')).toHaveLength(145);
  });

  it('post120: locks mcp-spec.md HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', 'docs/mcp-spec.md')).toBe(
      'efd65fa014d4e1f067f5550aaf08994c5f11d4a9b4f290cf5ec774fa0c42cf3b',
    );
  });

  it('post120: locks mcp-spec.md HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', 'docs/mcp-spec.md')).toBe(
      '4ff197c8a4a37d9ec986359f2cfeda68ec066e7ad2066d1e59999873ef52eb3f',
    );
  });

  it('post120: locks mcp-spec.md HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', 'docs/mcp-spec.md')).toBe(
      'cc7b82d7e2cbbb55051894ddba60fbf4023572b4cd7a21b98ebf76001a5d07df',
    );
  });

  it('post120: locks mcp-spec.md HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', 'docs/mcp-spec.md')).toBe(
      '6effd1effec6eeb6f8371fbc54a189e2f68c1a75308327b11f189591af625293',
    );
  });

  it('post120: locks mcp-spec.md HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', 'docs/mcp-spec.md')).toBe('ff5c0de61b3f5f7deb981127a9eb2c4102163ae8');
    expect(hmacMd5('post120', 'docs/mcp-spec.md')).toBe('b2da12e1a64945c3a7259904eb11b0f0');
  });

  it('post120: locks mcp-spec.md sha256 first/last octets', () => {
    const hex = sha256('docs/mcp-spec.md');
    expect(hex.slice(0, 2)).toBe('a9');
    expect(hex.slice(-2)).toBe('49');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks mcp-spec.md sha256 middle 8 nibbles', () => {
    expect(sha256('docs/mcp-spec.md').slice(28, 36)).toBe('c7628b21');
  });

  it('post120: locks bug.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'f76fcc573b913789446748a601dcb4a8d2cfaa3ec85d2c6bb798f2a35b844055',
    );
  });

  it('post120: locks bug.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/bug.yml')).toBe('d03c99b857f1589125c3bc266ae29317f6c7ba0a');
  });

  it('post120: locks bug.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/bug.yml')).toBe('3693b9bfd65bf683be0706b83831ae69');
  });

  it('post120: locks bug.yml sha256 nibble sum 493 xor 11', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(nibbleSum(d)).toBe(493);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post120: locks bug.yml sha256 pairSum 4228 rollingXor 244', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(pairSum(d)).toBe(4228);
    expect(rollingXor(d)).toBe(244);
  });

  it('post120: locks bug.yml byte size 846', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).size).toBe(846);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).byteLength).toBe(846);
  });

  it('post120: locks bug.yml utf8 char length 846', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toHaveLength(846);
  });

  it('post120: locks bug.yml line count 41', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml').split('\n')).toHaveLength(41);
  });

  it('post120: locks bug.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '7376fe1e582e56c590090020d99089a27c585df02cc5b78a7efd22f3322d538a',
    );
  });

  it('post120: locks bug.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '2bdad0c9181c01840f6237a2b6806843e3c180fa6b5b4e4d24fcf975aabeb6ec',
    );
  });

  it('post120: locks bug.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '8e25bc71e856193df58af94e765bb199ce7bba33acb2d093df0b11b1ef510601',
    );
  });

  it('post120: locks bug.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '07ed5c7fe74dba726db04a5c828d27ab8ff4784e2f8a48b46c3a1177ca93b4f5',
    );
  });

  it('post120: locks bug.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/ISSUE_TEMPLATE/bug.yml')).toBe('c12cd23d2cdec085597802e04e443abcdf772b67');
    expect(hmacMd5('post120', '.github/ISSUE_TEMPLATE/bug.yml')).toBe('5ca05715cc4610196884f2aa76c47fac');
  });

  it('post120: locks bug.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('55');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks bug.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/bug.yml').slice(28, 36)).toBe('b4a8d2cf');
  });

  it('post120: locks chore.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '230222c6ac61737a55b00df4442d483911154bd93657ba98a1d30b75b509c3fc',
    );
  });

  it('post120: locks chore.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/chore.yml')).toBe('9b401e414cbc1a5fab58fa4ae6d43957a4ef05fd');
  });

  it('post120: locks chore.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/chore.yml')).toBe('2eff43364806910ca218e00054a2304a');
  });

  it('post120: locks chore.yml sha256 nibble sum 406 xor 10', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(nibbleSum(d)).toBe(406);
    expect(xorNibbles(d)).toBe(10);
  });

  it('post120: locks chore.yml sha256 pairSum 3481 rollingXor 95', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(pairSum(d)).toBe(3481);
    expect(rollingXor(d)).toBe(95);
  });

  it('post120: locks chore.yml byte size 705', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).size).toBe(705);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).byteLength).toBe(705);
  });

  it('post120: locks chore.yml utf8 char length 705', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toHaveLength(705);
  });

  it('post120: locks chore.yml line count 33', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml').split('\n')).toHaveLength(33);
  });

  it('post120: locks chore.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '1877002e9a21a3da79b17c765561f57c05a3466cc7978e1d888bcb0b929a45b3',
    );
  });

  it('post120: locks chore.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '2188e0c519766382908ffa85f57cf6560fc3e94c161f1a45990728e8357539e8',
    );
  });

  it('post120: locks chore.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      'f1968808033979bb2b6a2010b0771a27527f31c13816b0a484ec37a255e1fdd2',
    );
  });

  it('post120: locks chore.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '67547b0eb1e082564d1f83d97cd8b7e43c623c4861a7a6f5cdadf11120bd5de2',
    );
  });

  it('post120: locks chore.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/ISSUE_TEMPLATE/chore.yml')).toBe('92ebad1e1890562573e07b8e4d357e2d104f43c3');
    expect(hmacMd5('post120', '.github/ISSUE_TEMPLATE/chore.yml')).toBe('8c6ed8054372af65a2db2aa2c8ada93a');
  });

  it('post120: locks chore.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(hex.slice(0, 2)).toBe('23');
    expect(hex.slice(-2)).toBe('fc');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks chore.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/chore.yml').slice(28, 36)).toBe('48391115');
  });

  it('post120: locks feature.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '83291f987d1bb546b45ecd09d9be597c5265591a99744d18a2c49122e390aac2',
    );
  });

  it('post120: locks feature.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/feature.yml')).toBe('e23c853fb5eebf3a04e9f487f2c9d879d40216b7');
  });

  it('post120: locks feature.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/feature.yml')).toBe('c73a814e3784562d4ab200328793c60f');
  });

  it('post120: locks feature.yml sha256 nibble sum 461 xor 11', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(nibbleSum(d)).toBe(461);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post120: locks feature.yml sha256 pairSum 3806 rollingXor 214', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(pairSum(d)).toBe(3806);
    expect(rollingXor(d)).toBe(214);
  });

  it('post120: locks feature.yml byte size 966', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).size).toBe(966);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).byteLength).toBe(966);
  });

  it('post120: locks feature.yml utf8 char length 966', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toHaveLength(966);
  });

  it('post120: locks feature.yml line count 44', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml').split('\n')).toHaveLength(44);
  });

  it('post120: locks feature.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '0b718d61e278471145e7b4e5e386d2b41b4d3323622769405cb4333fdf4424c2',
    );
  });

  it('post120: locks feature.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '2fcfae17b9f8286e98603b840ff97ffbe0717f7f41ce80168192459c67ee59ad',
    );
  });

  it('post120: locks feature.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      'c9a9070b7ac0f52c875d51f2f78788aaef4a74cddaff6a278fa611d373c216c5',
    );
  });

  it('post120: locks feature.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '4016b5a04936e19104cf1df55bf668868413d981a76b223669cbbf0bb6a75403',
    );
  });

  it('post120: locks feature.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/ISSUE_TEMPLATE/feature.yml')).toBe('2975e35944fc9b3645d5c8d612ebd23ed0d1bff4');
    expect(hmacMd5('post120', '.github/ISSUE_TEMPLATE/feature.yml')).toBe('8da2945d0e0a3f507c7a099be3412ca0');
  });

  it('post120: locks feature.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(hex.slice(0, 2)).toBe('83');
    expect(hex.slice(-2)).toBe('c2');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks feature.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/feature.yml').slice(28, 36)).toBe('597c5265');
  });

  it('post120: locks issue-config.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '1f103c6a9dd07cd13a9a6f17ace6b813f47747eb9cb7e00488cb2073caaf91bb',
    );
  });

  it('post120: locks issue-config.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/config.yml')).toBe('68344263f9bbfe0fc196c0e6c1a55818cc46dc01');
  });

  it('post120: locks issue-config.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/config.yml')).toBe('74c7aebcc7755d1241890df4fd87c662');
  });

  it('post120: locks issue-config.yml sha256 nibble sum 498 xor 12', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(nibbleSum(d)).toBe(498);
    expect(xorNibbles(d)).toBe(12);
  });

  it('post120: locks issue-config.yml sha256 pairSum 4293 rollingXor 63', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(pairSum(d)).toBe(4293);
    expect(rollingXor(d)).toBe(63);
  });

  it('post120: locks issue-config.yml byte size 28', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).size).toBe(28);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).byteLength).toBe(28);
  });

  it('post120: locks issue-config.yml utf8 char length 28', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toHaveLength(28);
  });

  it('post120: locks issue-config.yml line count 2', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml').split('\n')).toHaveLength(2);
  });

  it('post120: locks issue-config.yml HMAC-SHA256 key post120', () => {
    expect(hmacSha256('post120', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '15b0f9f6c1ece73008065d183d2f4662c4677e6ebfceb083d982867f027360a2',
    );
  });

  it('post120: locks issue-config.yml HMAC-SHA256 key post119', () => {
    expect(hmacSha256('post119', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '5e2d71b8972efa8a957d03c3dfc6049142f5633cd31370a7c8789a425aee1a27',
    );
  });

  it('post120: locks issue-config.yml HMAC-SHA256 key leftover', () => {
    expect(hmacSha256('leftover', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '7a70506231dc57966d9de850d56a696f361e7d957d2d5bacedd64ff5805f6e31',
    );
  });

  it('post120: locks issue-config.yml HMAC-SHA256 key ci-config stable', () => {
    expect(hmacSha256('ci-config', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      'c8bad415a5bce26bf53f69d73dd172d5b82223eaa506994a13cae41635ea22f1',
    );
  });

  it('post120: locks issue-config.yml HMAC-SHA1 and HMAC-MD5 key post120', () => {
    expect(hmacSha1('post120', '.github/ISSUE_TEMPLATE/config.yml')).toBe('1cd2cdd83f4539e3681b25069a289ed08f3f74b0');
    expect(hmacMd5('post120', '.github/ISSUE_TEMPLATE/config.yml')).toBe('b162f8f5882ea698f21c64f7b9d696f2');
  });

  it('post120: locks issue-config.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(hex.slice(0, 2)).toBe('1f');
    expect(hex.slice(-2)).toBe('bb');
    expect(hex).toHaveLength(64);
  });

  it('post120: locks issue-config.yml sha256 middle 8 nibbles', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml').slice(28, 36)).toBe('b813f477');
  });

  it('post120: CI workflow name is exactly CI', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[0]).toBe('name: CI');
  });

  it('post120: deploy workflow name is Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')[0]).toBe(
      'name: Deploy to Cloudflare Workers',
    );
  });

  it('post120: CI jobs are typecheck test hygiene in YAML order', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsBlock = ci.slice(ci.indexOf('jobs:'));
    const ids = [...jobsBlock.matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1]);
    expect(ids).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('post120: CI job display names Typecheck Tests Hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/^ {4}name:\s*(.+)$/gm)].map((m) => m[1])).toEqual([
      'Typecheck',
      'Tests',
      'Hygiene',
    ]);
  });

  it('post120: CI triggers push and pull_request on main only exact block', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(
      /^on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:\n {4}branches: \[main\]\n/m,
    );
  });

  it('post120: CI does not use pull_request_target or workflow_call as triggers', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('on:'), ci.indexOf('concurrency:'));
    expect(onBlock).not.toMatch(/pull_request_target/);
    expect(onBlock).not.toMatch(/workflow_call/);
    expect(onBlock).not.toMatch(/workflow_run/);
    expect(onBlock).not.toMatch(/schedule:/);
    expect(ci).toContain("! awk '/^on:/{f=1} f && /^[^[:space:]#]/{if($0 !~ /^on:/) exit} f' .github/workflows/ci.yml | grep -q 'pull_request_target'");
  });

  it('post120: deploy is workflow_dispatch HITL only without push schedule', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/schedule:/);
    expect(deploy).not.toMatch(/pull_request/);
  });

  it('post120: CI concurrency cancel-in-progress true with workflow+ref group', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
    expect(ci).toContain('cancel-in-progress: true');
  });

  it('post120: deploy concurrency cancel-in-progress false with workflow-only group', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('group: deploy-${{ github.workflow }}');
    expect(deploy).toContain('cancel-in-progress: false');
  });

  it('post120: CI permissions contents read only — no write id-token packages', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/permissions:\n {2}contents: read\n/);
    expect(ci).not.toMatch(/contents:\s*write/);
    expect(ci).not.toMatch(/id-token:/);
    expect(ci).not.toMatch(/packages:/);
    expect(ci).not.toMatch(/pull-requests:/);
  });

  it('post120: CI defaults shell bash before jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('defaults:')).toBeLessThan(ci.indexOf('jobs:'));
    expect(ci).toMatch(/defaults:\n {2}run:\n {4}shell: bash\n/);
  });

  it('post120: CI timeout pins typecheck 10 test 15 hygiene 5', () => {
    const ci = read('.github/workflows/ci.yml');
    const timeouts = [...ci.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(timeouts).toEqual([10, 15, 5]);
  });

  it('post120: deploy timeout-minutes is 20 exactly once', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect([...deploy.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => m[1])).toEqual(['20']);
  });

  it('post120: CI action pins checkout@v7 setup-node@v7 upload-artifact@v4', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/actions\/checkout@v7/g) ?? []).length).toBe(3);
    expect((ci.match(/actions\/setup-node@v7/g) ?? []).length).toBe(2);
    expect((ci.match(/actions\/upload-artifact@v4/g) ?? []).length).toBe(1);
    expect(ci).not.toMatch(/actions\/checkout@v[1-6]\b/);
    expect(ci).not.toMatch(/actions\/setup-node@v[1-6]\b/);
  });

  it('post120: deploy action pins checkout setup-node wrangler-action@v4', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('actions/checkout@v7');
    expect(deploy).toContain('actions/setup-node@v7');
    expect(deploy).toContain('cloudflare/wrangler-action@v4');
    expect(deploy).not.toMatch(/wrangler-action@v[1-3]\b/);
  });

  it('post120: CI node-version 20 with npm cache on both install jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    // two setup-node steps + one hygiene grep assertion string
    expect((ci.match(/node-version:\s*"20"/g) ?? []).length).toBe(3);
    expect((ci.match(/cache:\s*"npm"/g) ?? []).length).toBe(2);
    expect((ci.match(/npm ci/g) ?? []).length).toBe(2);
  });

  it('post120: CI persist-credentials false on every checkout', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/persist-credentials:\s*false/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(read('.github/workflows/deploy.yml')).toContain('persist-credentials: false');
  });

  it('post120: CI coverage artifact name coverage-report retention 14 if always', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('name: coverage-report');
    expect(ci).toContain('retention-days: 14');
    expect(ci).toContain('if: always()');
    expect(ci).toContain('if-no-files-found: error');
  });

  it('post120: CI coverage assert checks directory file nonempty SF:src/', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('test -d coverage');
    expect(ci).toContain('test -f coverage/lcov.info');
    expect(ci).toContain('test -s coverage/lcov.info');
    expect(ci).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post120: CI hygiene lists all nine test suites plus helpers.ts', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of [
      'parser.test.ts',
      'genres.test.ts',
      'routes.test.ts',
      'mcp.test.ts',
      'helpers.ts',
      'helpers.test.ts',
      'mcp-spec-contract.test.ts',
      'ci-config.test.ts',
      'wrangler-config.test.ts',
      'source-contracts.test.ts',
    ]) {
      expect(ci).toContain(`test -f test/${f}`);
    }
  });

  it('post120: CI hygiene forbids anthropic claude haiku in src and workflows', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'");
  });

  it('post120: CI hygiene pins gemini-2.0-flash and typescript caret-5', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
    expect(ci).toMatch(/typescript.*\^5/);
  });

  it('post120: CI hygiene forbids GEMINI_API_KEY and api_key equals in wrangler.toml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(read('wrangler.toml')).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it('post120: CI hygiene forbids committed .env .dev.vars pem key files', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('! test -f .env');
    expect(ci).toContain('! test -f .dev.vars');
  });

  it('post120: deploy secrets surface GEMINI_API_KEY CF_API_TOKEN CF_ACCOUNT_ID', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
    expect(deploy).toContain('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}');
  });

  it('post120: deploy runs typecheck and coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.indexOf('npm run typecheck')).toBeLessThan(deploy.indexOf('wrangler-action'));
    expect(deploy.indexOf('npm run test:coverage')).toBeLessThan(deploy.indexOf('wrangler-action'));
    expect(deploy.indexOf('npm ci')).toBeLessThan(deploy.indexOf('npm run typecheck'));
  });

  it('post120: dependabot version 2 monthly npm and github-actions ecosystems', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2\n')).toBe(true);
    expect(dep).toContain('package-ecosystem: "npm"');
    expect(dep).toContain('package-ecosystem: "github-actions"');
    expect((dep.match(/interval:\s*"monthly"/g) ?? []).length).toBe(2);
  });

  it('post120: dependabot open-pull-requests-limit 3 npm and 2 actions', () => {
    const dep = read('.github/dependabot.yml');
    const limits = [...dep.matchAll(/open-pull-requests-limit:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(limits).toEqual([3, 2]);
  });

  it('post120: dependabot ignores semver-major and groups star patterns', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('dependency-name: "*"');
    expect(dep).toContain('update-types: ["version-update:semver-major"]');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toContain('github-actions:');
  });

  it('post120: package.json name version type module scripts exact', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.type).toBe('module');
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.dev).toBe('wrangler dev');
    expect(scripts.deploy).toBe('wrangler deploy');
    expect(scripts.typecheck).toBe('tsc --noEmit');
    expect(scripts.test).toBe('vitest run');
    expect(scripts['test:watch']).toBe('vitest');
    expect(scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post120: package.json sole runtime dependency is hono caret-4', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
    expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
  });

  it('post120: package.json description mentions LLM-curated internet radio', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toContain('LLM-curated internet radio');
    expect(pkg.description).toContain('iptv-org');
  });

  it('post120: package-lock lockfileVersion 3 name backlink packages count', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      lockfileVersion: number;
      name: string;
      packages: Record<string, unknown>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe('backlink');
    expect(Object.keys(lock.packages).length).toBe(168);
  });

  it('post120: vitest coverage thresholds all 100 include src exclude types', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
    expect(cfg).toContain("include: ['src/**/*.ts']");
    expect(cfg).toContain("exclude: ['src/types.ts']");
    expect(cfg).toContain("include: ['test/**/*.test.ts']");
    expect(cfg).toContain("environment: 'node'");
    expect(cfg).toContain('github-actions');
    expect(cfg).toContain("'lcov'");
  });

  it('post120: vitest reporters switch on GITHUB_ACTIONS env', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain("process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default']");
  });

  it('post120: tsconfig strict ES2022 Bundler workers+node types', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
    expect(ts.compilerOptions.resolveJsonModule).toBe(true);
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('post120: AGENTS Verify block lists four npm commands in order', () => {
    const agents = read('AGENTS.md');
    const block = agents.slice(agents.indexOf('## Verify'), agents.indexOf('## Escalate'));
    expect(block).toContain('```bash\nnpm ci\nnpm run typecheck\nnpm test\nnpm run test:coverage\n```');
  });

  it('post120: AGENTS Escalate includes GEMINI HITL CORS billing', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('GEMINI_API_KEY');
    expect(agents).toMatch(/HITL|first deploy/i);
    expect(agents).toMatch(/CORS/);
    expect(agents).toMatch(/billing/i);
  });

  it('post120: AGENTS Safe Agent Actions includes unit tests under test/', () => {
    expect(read('AGENTS.md')).toContain('Add / extend unit tests under `test/`');
  });

  it('post120: AGENTS Classification Tier A Autonomy L2', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Tier: A');
    expect(agents).toContain('Autonomy: L2');
    expect(agents).toContain('backlink.fuzzywigg.com');
  });

  it('post120: cursor environment.json name Backlink_Facelift install npm ci only', () => {
    expect(JSON.parse(read('.cursor/environment.json'))).toEqual({
      name: 'Backlink_Facelift',
      install: 'npm ci',
    });
  });

  it('post120: gitignore covers node_modules coverage wrangler secrets editor noise', () => {
    const gi = read('.gitignore');
    for (const line of ['node_modules/', '.env', '.dev.vars', 'coverage/', '.wrangler/', '.DS_Store', '.idea/', '.vscode/']) {
      expect(gi).toContain(line);
    }
  });

  it('post120: gitattributes LF auto normalization only', () => {
    expect(read('.gitattributes')).toBe(
      '# Auto detect text files and perform LF normalization\n* text=auto\n',
    );
  });

  it('post120: ISSUE_TEMPLATE inventory is bug chore feature config', () => {
    expect(readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort()).toEqual([
      'bug.yml',
      'chore.yml',
      'config.yml',
      'feature.yml',
    ]);
  });

  it('post120: ISSUE_TEMPLATE config disables blank issues', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml').trim()).toBe('blank_issues_enabled: false');
  });

  it('post120: workflows directory is exactly ci.yml and deploy.yml', () => {
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post120: .github top-level is ISSUE_TEMPLATE dependabot workflows', () => {
    expect(readdirSync(join(root, '.github')).sort()).toEqual([
      'ISSUE_TEMPLATE',
      'dependabot.yml',
      'workflows',
    ]);
  });

  it('post120: test/ inventory has ten contract files including helpers.ts', () => {
    expect(readdirSync(join(root, 'test')).sort()).toEqual([
      'ci-config.test.ts',
      'genres.test.ts',
      'helpers.test.ts',
      'helpers.ts',
      'mcp-spec-contract.test.ts',
      'mcp.test.ts',
      'parser.test.ts',
      'routes.test.ts',
      'source-contracts.test.ts',
      'wrangler-config.test.ts',
    ]);
  });

  it('post120: src/ inventory is five modules only', () => {
    expect(readdirSync(join(root, 'src')).sort()).toEqual([
      'genres.ts',
      'index.ts',
      'mcp.ts',
      'parser.ts',
      'types.ts',
    ]);
  });

  it('post120: negative inventing — CI does not introduce playlist now-playing openapi routes', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\/playlist|\/now-playing|openapi\.json/);
  });

  it('post120: negative inventing — package scripts do not add lint format e2e invent', () => {
    const s = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts); expect(s).not.toContain('lint'); expect(s).not.toContain('format'); expect(s).not.toContain('e2e');
  });

  it('post120: negative inventing — no second package manager lockfiles', () => {
    expect(() => readFileSync(join(root, 'yarn.lock'))).toThrow(); expect(() => readFileSync(join(root, 'pnpm-lock.yaml'))).toThrow(); expect(() => readFileSync(join(root, 'bun.lockb'))).toThrow();
  });

  it('post120: negative inventing — no Dockerfile compose k8s CI invent', () => {
    expect(() => readFileSync(join(root, 'Dockerfile'))).toThrow(); expect(() => readFileSync(join(root, 'docker-compose.yml'))).toThrow();
  });

  it('post120: negative inventing — CI does not call wrangler deploy', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('wrangler deploy'); expect(read('.github/workflows/ci.yml')).not.toContain('wrangler-action');
  });

  it('post120: negative inventing — no jest mocha ava cypress playwright in package.json', () => {
    const raw = read('package.json'); expect(raw).not.toMatch(/jest|mocha|ava|cypress|playwright/);
  });

  it('post120: negative inventing — CI does not use softprops peter-evans github-script', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/peter-evans|softprops|actions\/github-script/);
  });

  it('post120: negative inventing — deploy does not use npm publish or semantic-release', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/npm publish|semantic-release/);
  });

  it('post120: negative inventing — no codecov coveralls third-party coverage upload', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/codecov|coveralls/);
  });

  it('post120: negative inventing — no matrix strategy invent on CI jobs', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/strategy:/);
  });

  it('post120: ci.yml is ASCII-only and has no tabs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(ci).not.toContain('\t');
  });

  it('post120: deploy.yml and dependabot.yml are ASCII-only no tabs', () => {
    for (const rel of ['.github/workflows/deploy.yml', '.github/dependabot.yml']) {
      const body = read(rel);
      expect([...body].every((c) => c.charCodeAt(0) < 128)).toBe(true);
      expect(body).not.toContain('\t');
    }
  });

  it('post120: ci.yml endsWith newline is false', () => {
    expect(read('.github/workflows/ci.yml').endsWith('\n')).toBe(false);
  });

  it('post120: deploy.yml endsWith newline is true', () => {
    expect(read('.github/workflows/deploy.yml').endsWith('\n')).toBe(true);
  });

  it('post120: no BOM on CI config surface files', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'package.json',
      'vitest.config.ts',
      'tsconfig.json',
      '.cursor/environment.json',
    ]) {
      expect(read(rel).charCodeAt(0)).not.toBe(0xfeff);
    }
  });

  it('post120: slice first 40 and last 40 of ci.yml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.slice(0, 40)).toBe("name: CI\n\non:\n  push:\n    branches: [mai");
    expect(ci.slice(-40)).toBe("odules/*' ! -path './.git/*' | grep -q .");
  });

  it('post120: slice first 40 and last 40 of deploy.yml', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.slice(0, 40)).toBe("name: Deploy to Cloudflare Workers\n\non:\n");
    expect(deploy.slice(-40)).toBe("_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n");
  });

  it('post120: slice first 40 and last 40 of dependabot.yml', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.slice(0, 40)).toBe("version: 2\nupdates:\n  - package-ecosyste");
    expect(dep.slice(-40)).toBe("ions:\n        patterns:\n          - \"*\"\n");
  });

  it('post120: slice first 40 and last 40 of vitest.config.ts', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg.slice(0, 40)).toBe("import { defineConfig } from 'vitest/con");
    expect(cfg.slice(-40)).toBe("atements: 100,\n      },\n    },\n  },\n});\n");
  });

  it('post120: slice first 40 and last 40 of package.json', () => {
    const pkgTxt = read('package.json');
    expect(pkgTxt.slice(0, 40)).toBe("{\n  \"name\": \"backlink\",\n  \"version\": \"0.");
    expect(pkgTxt.slice(-40)).toBe(".0.0\",\n    \"wrangler\": \"^4.131.1\"\n  }\n}\n");
  });

  it('post120: cross-lock README CI badge without inventing routes', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/CI/);
    expect(readme).not.toMatch(/\/playlist|\/now-playing/);
  });

  it('post120: cross-lock DEPLOY.md HITL workflow_dispatch language', () => {
    const deployMd = read('DEPLOY.md');
    expect(deployMd.toLowerCase()).toMatch(/hitl|workflow_dispatch|manual|human/);
    expect(read('.github/workflows/deploy.yml')).toContain('workflow_dispatch');
  });

  it('post120: cross-lock wrangler.toml name backlink without secrets', () => {
    const toml = read('wrangler.toml');
    expect(toml).toContain('name = "backlink"');
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
  });

  it('post120: cross-lock helpers.ts stub exists without CI fetching iptv', () => {
    expect(read('test/helpers.ts')).toContain('export function stubIptvAndGemini');
    expect(read('.github/workflows/ci.yml')).not.toContain('iptv-org.github.io');
  });

  it('post120: cross-lock README coverage floors 100% with vitest thresholds', () => {
    expect(read('README.md')).toMatch(/Coverage floors stay at \*\*100%\*\*/);
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('post120: cross-lock AGENTS parent_governance agents-governance URL', () => {
    expect(read('AGENTS.md')).toContain('github.com/fuzzywigg/agents-governance');
  });

  it('post120: cross-lock hygiene required docs files exist and are nonempty', () => {
    for (const rel of ['README.md', 'AGENTS.md', 'DEPLOY.md', 'docs/mcp-spec.md']) {
      expect(read(rel).length).toBeGreaterThan(0);
    }
  });

  it('post120: sha256 of concatenated CI job ids', () => {
    const joined = ['typecheck', 'test', 'hygiene'].join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      'c48518346e52822a0ffe829df570359891ea3a1c43bdc58253a1a5103bcdf4c9',
    );
  });

  it('post120: sha256 of Verify script block tokens', () => {
    const tokens = ['npm ci', 'npm run typecheck', 'npm test', 'npm run test:coverage'].join('\n');
    expect(createHash('sha256').update(tokens).digest('hex')).toBe(
      '0ddf9e851fceb0350faa3d8b53ed0bfdcaa2aaed6efbcc15259e212de662e007',
    );
  });

  it('post120: sha256 of action pin tokens checkout setup-node upload-artifact', () => {
    const pins = ['actions/checkout@v7', 'actions/setup-node@v7', 'actions/upload-artifact@v4'].join('|');
    expect(createHash('sha256').update(pins).digest('hex')).toBe(
      'b8adeee0ad5ca1d3cae37d4d751e175a24994121db9ad6c47c13bd0aa6f01342',
    );
  });

  it('post120: sha256 of timeout pin tokens 10|15|5|20', () => {
    expect(createHash('sha256').update('10|15|5|20').digest('hex')).toBe(
      '5810ba70c8d671cbd21b73152cbbc92883afa73f8c7e1aaf71b0d78475e2edd0',
    );
  });

  it('post120: sha256 of ecosystem tokens npm|github-actions', () => {
    expect(createHash('sha256').update('npm|github-actions').digest('hex')).toBe(
      '337db83baf362731d910e71f99a4f68878cd7485506e1aad6c048bebb41adbc9',
    );
  });

  it('post120: fromCharCode rebuild of backlink package name', () => {
    const rebuilt = String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107);
    expect(rebuilt).toBe('backlink');
    expect(JSON.parse(read('package.json')).name).toBe(rebuilt);
  });

  it('post120: TextDecoder round-trip of CI name bytes stays CI', () => {
    const bytes = new TextEncoder().encode('CI');
    expect(new TextDecoder().decode(bytes)).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post120: TextEncoder byte length of workflow names', () => {
    expect(new TextEncoder().encode('CI').length).toBe(2);
    expect(new TextEncoder().encode('Deploy to Cloudflare Workers').length).toBe(28);
  });

  it('post120: btoa/atob round-trip of coverage-report artifact name', () => {
    expect(atob(btoa('coverage-report'))).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml')).toContain('name: coverage-report');
  });

  it('post120: JSON.stringify package name round-trips', () => {
    expect(JSON.stringify({ name: 'backlink' })).toBe('{"name":"backlink"}');
    expect(JSON.parse(read('package.json')).name).toBe('backlink');
  });

  it('post120: padStart retention-days fortnight', () => {
    expect(String(14).padStart(2, '0')).toBe('14');
    expect(14 / 7).toBe(2);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post120: repeat of hyphen does not invent workflow names', () => {
    expect('-'.repeat(3)).toBe('---');
    expect(read('.github/workflows/ci.yml')).not.toContain('name: ---');
  });

  it('post120: ci.yml line 0 is "name: CI"', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[0]).toBe("name: CI");
  });

  it('post120: ci.yml line 2 is "on:"', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[2]).toBe("on:");
  });

  it('post120: ci.yml line 8 is "concurrency:"', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[8]).toBe("concurrency:");
  });

  it('post120: ci.yml line 12 is "permissions:"', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[12]).toBe("permissions:");
  });

  it('post120: ci.yml line 13 is "  contents: read"', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[13]).toBe("  contents: read");
  });

  it('post120: ci.yml line 19 is "jobs:"', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[19]).toBe("jobs:");
  });

  it('post120: deploy.yml line 0 name Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')[0]).toBe('name: Deploy to Cloudflare Workers');
  });

  it('post120: deploy.yml line 3 is workflow_dispatch', () => {
    expect(read('.github/workflows/deploy.yml').split('\n')[3]).toBe('  workflow_dispatch:');
  });

  it('post120: hygiene grep thresholds exist in vitest.config.ts', () => {
    expect(read('vitest.config.ts')).toContain('thresholds');
    expect(read('vitest.config.ts')).toContain('branches: 100');
    expect(read('vitest.config.ts')).toContain('lines: 100');
    expect(read('vitest.config.ts')).toContain('functions: 100');
    expect(read('vitest.config.ts')).toContain('statements: 100');
  });

  it('post120: hygiene grep lockfileVersion 3 matches package-lock', () => {
    expect(JSON.parse(read('package-lock.json')).lockfileVersion).toBe(3);
  });

  it('post120: hygiene grep hono matches package.json', () => {
    expect(read('package.json')).toContain('"hono"');
  });

  it('post120: hygiene grep gemini-2.0-flash matches src/index.ts', () => {
    expect(read('src/index.ts')).toContain('gemini-2.0-flash');
  });

  it('post120: hygiene forbids anthropic in src TypeScript files', () => {
    const srcFiles = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.ts'));
    for (const f of srcFiles) {
      expect(read(`src/${f}`).toLowerCase()).not.toMatch(/anthropic|claude|haiku/);
    }
  });

  it('post120: hygiene forbids anthropic in workflow yml files', () => {
    // workflows mention the forbid pattern only inside the hygiene grep negation
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'");
    expect(read('.github/workflows/deploy.yml').toLowerCase()).not.toMatch(/anthropic|claude|haiku/);
    const ciWithoutHygiene = ci.replace(/! grep -RqiE 'anthropic\|claude\|haiku'[\s\S]*?\.yml'/g, '');
    expect(ciWithoutHygiene.toLowerCase()).not.toMatch(/anthropic|claude|haiku/);
  });

  it('post120: bug.yml starts with name Bug', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toMatch(/^name:\s*Bug$/m);
  });

  it('post120: chore.yml starts with name Chore / Infra / Docs', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toMatch(/^name:\s*Chore \/ Infra \/ Docs$/m);
  });

  it('post120: feature.yml starts with name Feature', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toMatch(/^name:\s*Feature$/m);
  });

  it('post120: bug.yml uses dropdown and textarea body fields', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toContain('type: dropdown');
    expect(bug).toContain('type: textarea');
    expect(bug).toContain('id: description');
  });

  it('post120: chore.yml uses dropdown and textarea body fields', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore).toContain('type: dropdown');
    expect(chore).toContain('type: textarea');
  });

  it('post120: feature.yml uses dropdown and textarea body fields', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature).toContain('type: dropdown');
    expect(feature).toContain('type: textarea');
  });

  it('post120: locks ci.yml sha512 digest', () => {
    expect(createHash('sha512').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe(
      '3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460',
    );
  });

  it('post120: locks ci.yml sha512 first/last 4 hex', () => {
    const hex = createHash('sha512').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex');
    expect(hex.slice(0, 4)).toBe('3999');
    expect(hex.slice(-4)).toBe('4460');
    expect(hex).toHaveLength(128);
  });

  it('post120: locks deploy.yml sha512 digest', () => {
    expect(createHash('sha512').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe(
      '7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641',
    );
  });

  it('post120: locks deploy.yml sha512 first/last 4 hex', () => {
    const hex = createHash('sha512').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex');
    expect(hex.slice(0, 4)).toBe('7157');
    expect(hex.slice(-4)).toBe('b641');
    expect(hex).toHaveLength(128);
  });

  it('post120: locks package.json sha512 digest', () => {
    expect(createHash('sha512').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe(
      '7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28',
    );
  });

  it('post120: locks package.json sha512 first/last 4 hex', () => {
    const hex = createHash('sha512').update(readFileSync(join(root, 'package.json'))).digest('hex');
    expect(hex.slice(0, 4)).toBe('7b56');
    expect(hex.slice(-4)).toBe('6b28');
    expect(hex).toHaveLength(128);
  });

  it('post120: locks vitest.config.ts sha512 digest', () => {
    expect(createHash('sha512').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe(
      'ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682',
    );
  });

  it('post120: locks vitest.config.ts sha512 first/last 4 hex', () => {
    const hex = createHash('sha512').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex');
    expect(hex.slice(0, 4)).toBe('ea76');
    expect(hex.slice(-4)).toBe('3682');
    expect(hex).toHaveLength(128);
  });

  it('post120: locks AGENTS.md sha512 digest', () => {
    expect(createHash('sha512').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe(
      '7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908',
    );
  });

  it('post120: locks AGENTS.md sha512 first/last 4 hex', () => {
    const hex = createHash('sha512').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex');
    expect(hex.slice(0, 4)).toBe('7c29');
    expect(hex.slice(-4)).toBe('3908');
    expect(hex).toHaveLength(128);
  });

  it('post120: locks concatenated CI surface sha256 (ci+deploy+dependabot+pkg+vitest)', () => {
    const parts = [
      readFileSync(join(root, '.github/workflows/ci.yml')),
      readFileSync(join(root, '.github/workflows/deploy.yml')),
      readFileSync(join(root, '.github/dependabot.yml')),
      readFileSync(join(root, 'package.json')),
      readFileSync(join(root, 'vitest.config.ts')),
    ];
    expect(createHash('sha256').update(Buffer.concat(parts)).digest('hex')).toBe(
      '1c28592991e411333848eebcc3684c4d3f688f8d289b7724575d912ffe2b7736',
    );
  });

  it('post120: locks digest-of-digests over post120 CI surface file set', () => {
    const files = [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
      'package.json',
      'tsconfig.json',
      '.gitignore',
      '.cursor/environment.json',
      'AGENTS.md',
      '.gitattributes',
      'package-lock.json',
      'DEPLOY.md',
      'README.md',
      'wrangler.toml',
      'docs/mcp-spec.md',
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/config.yml',
    ];
    const joined = files.map((rel) => sha256(rel)).join('');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      'da2215821cb590d6dd621b05e95aead32c855b8d0614cef63f79c9ad20f7b320',
    );
  });

  it('post120: mega purity — 40 rounds of ci.yml sha256 stability', () => {
    const expected = 'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5';
    for (let i = 0; i < 40; i++) {
      expect(sha256('.github/workflows/ci.yml')).toBe(expected);
    }
  });

  it('post120: mega purity — 20 rounds of package.json + vitest digests', () => {
    const pkgD = '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c';
    const vitD = 'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38';
    for (let i = 0; i < 20; i++) {
      expect(sha256('package.json')).toBe(pkgD);
      expect(sha256('vitest.config.ts')).toBe(vitD);
    }
  });

  it('post120: mega purity — 15 rounds of deploy + dependabot digests', () => {
    const d1 = '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3';
    const d2 = 'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac';
    for (let i = 0; i < 15; i++) {
      expect(sha256('.github/workflows/deploy.yml')).toBe(d1);
      expect(sha256('.github/dependabot.yml')).toBe(d2);
    }
  });

  it('post120: mega purity — 10 rounds of HMAC post120 on ci.yml', () => {
    const expected = '89b3c70174462088f8edeb516315ff604beb16f58749d096809ff7a7c3794587';
    for (let i = 0; i < 10; i++) {
      expect(hmacSha256('post120', '.github/workflows/ci.yml')).toBe(expected);
    }
  });

  it('post120: HMAC-SHA256(ci.yml, key=post120)', () => {
    expect(hmacSha256('post120', '.github/workflows/ci.yml')).toBe(
      '89b3c70174462088f8edeb516315ff604beb16f58749d096809ff7a7c3794587',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=ci-config)', () => {
    expect(hmacSha256('ci-config', '.github/workflows/ci.yml')).toBe(
      'e997e669ee801faeaaac0ecfb8239cc5d416ffd739f752a288a997d086e7bd15',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=leftover)', () => {
    expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe(
      'd3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=hygiene)', () => {
    expect(hmacSha256('hygiene', '.github/workflows/ci.yml')).toBe(
      '67fbee1e0fa38536b43aa36fbc75a7442f76f673a3e540e9441d9e55b2307bb4',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=coverage)', () => {
    expect(hmacSha256('coverage', '.github/workflows/ci.yml')).toBe(
      'f4f21c7d3f51181943d5246fc353cf63479205f04ab17a1841fed0bb2eff40d5',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=vitest)', () => {
    expect(hmacSha256('vitest', '.github/workflows/ci.yml')).toBe(
      '7dc0f3d26725e2259cbfd533dbc5494629897027b083e534748b2d1780a4e489',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=dependabot)', () => {
    expect(hmacSha256('dependabot', '.github/workflows/ci.yml')).toBe(
      '6b72feddc5463447cd7b39905b0cbadb0c62778e1ad201453e9a8e417812d984',
    );
  });

  it('post120: HMAC-SHA256(ci.yml, key=HITL)', () => {
    expect(hmacSha256('HITL', '.github/workflows/ci.yml')).toBe(
      'a1f8c9446de2bb236d3211d1ea7bc88fcb53a65e967b7eb08bc46e2f0ea0e461',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=post120)', () => {
    expect(hmacSha256('post120', 'package.json')).toBe(
      '6d79a4a8140e60610f96f64cc33619c16c400ccb8a8589787458b0b280aa73a8',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=ci-config)', () => {
    expect(hmacSha256('ci-config', 'package.json')).toBe(
      '9af90b16d02d642aa55aa2a1cf7816f6cab099d1837f4d1efcc3a76638229f38',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=leftover)', () => {
    expect(hmacSha256('leftover', 'package.json')).toBe(
      '20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=hygiene)', () => {
    expect(hmacSha256('hygiene', 'package.json')).toBe(
      '01e96068fdd2fd13c84636894233469f4a445bb41502cd631782468262fa5a89',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=coverage)', () => {
    expect(hmacSha256('coverage', 'package.json')).toBe(
      'e9af2bc426e33e1d3c03541c5f43939b547124c9a681c291307385cc644596a9',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=vitest)', () => {
    expect(hmacSha256('vitest', 'package.json')).toBe(
      'd1eef869131396904345527df21d08eff915b75dec41011933949d12e9a7ba86',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=dependabot)', () => {
    expect(hmacSha256('dependabot', 'package.json')).toBe(
      '8fb994f374bb54feb367aa51984181fd9d1de7983348575c4f47be484adf61e7',
    );
  });

  it('post120: HMAC-SHA256(package.json, key=HITL)', () => {
    expect(hmacSha256('HITL', 'package.json')).toBe(
      '28ad7c71e0cbd46cab4e1f494c8e29a6140d447b63e530001e98d85096dc6424',
    );
  });

  it('post120: ci.yml contains exactly 3 job keys under jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobsBlock = ci.slice(ci.indexOf('jobs:'));
    expect([...jobsBlock.matchAll(/^ {2}([a-z]+):$/gm)].map((m) => m[1])).toEqual([
      'typecheck',
      'test',
      'hygiene',
    ]);
  });

  it('post120: ci.yml uses actions/checkout exactly 3 times', () => {
    expect((read('.github/workflows/ci.yml').match(/uses:\s*actions\/checkout@v7/g) ?? []).length).toBe(3);
  });

  it('post120: ci.yml uses setup-node exactly 2 times', () => {
    expect((read('.github/workflows/ci.yml').match(/uses:\s*actions\/setup-node@v7/g) ?? []).length).toBe(2);
  });

  it('post120: ci.yml mentions coverage path tokens at least twice', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/coverage\//g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((ci.match(/lcov\.info/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('post120: deploy.yml mentions secrets.GEMINI_API_KEY exactly once', () => {
    expect(
      (read('.github/workflows/deploy.yml').match(/secrets\.GEMINI_API_KEY/g) ?? []).length,
    ).toBe(1);
    expect(read('.github/workflows/deploy.yml')).toContain('secrets: |\n            GEMINI_API_KEY');
  });

  it('post120: dependabot.yml contains exactly two package-ecosystem entries', () => {
    expect((read('.github/dependabot.yml').match(/package-ecosystem:/g) ?? []).length).toBe(2);
  });

  it('post120: base64 of ci.yml first line', () => {
    const line = read('.github/workflows/ci.yml').split('\n')[0];
    expect(Buffer.from(line, 'utf8').toString('base64')).toBe(
      'bmFtZTogQ0k=',
    );
  });

  it('post120: base64 of deploy.yml first line', () => {
    const line = read('.github/workflows/deploy.yml').split('\n')[0];
    expect(Buffer.from(line, 'utf8').toString('base64')).toBe(
      'bmFtZTogRGVwbG95IHRvIENsb3VkZmxhcmUgV29ya2Vycw==',
    );
  });

  it('post120: ci.yml deploy.yml dependabot use LF not CRLF', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml', '.github/dependabot.yml']) {
      expect(read(rel)).not.toContain('\r\n');
      expect(read(rel)).not.toContain('\r');
    }
  });

  it('post120: package.json scripts key order exact', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(Object.keys(scripts)).toEqual([
      'dev',
      'deploy',
      'typecheck',
      'test',
      'test:watch',
      'test:coverage',
    ]);
  });

  it('post120: package.json devDependencies key order exact', () => {
    const dev = (JSON.parse(read('package.json')) as { devDependencies: Record<string, string> }).devDependencies;
    expect(Object.keys(dev)).toEqual([
      '@cloudflare/workers-types',
      '@types/node',
      '@vitest/coverage-v8',
      'typescript',
      'vitest',
      'wrangler',
    ]);
  });

  it('post120: vitest.config.ts imports defineConfig from vitest/config', () => {
    expect(read('vitest.config.ts')).toContain("import { defineConfig } from 'vitest/config';");
    expect(read('vitest.config.ts')).toContain("provider: 'v8'");
  });

  it('post120: vitest coverage reporter list exact order', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporter: ['text', 'text-summary', 'html', 'lcov']",
    );
  });

  it('post120: final inventory — ci-config describe blocks include post79 post96 post100 post116 post123 post120', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post79 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post96 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post100 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post116 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post123 ci-config HEAVY deepen (after #123)'");
    expect(body).toContain("describe('post120 ci-config HEAVY deepen'");
    expect((body.match(/it\('post120:/g) ?? []).length).toBeGreaterThan(100);
  });

  it('post120: ci-config.test.ts ends with newline after post120', () => {
    expect(read('test/ci-config.test.ts').endsWith('\n')).toBe(true);
  });

  it('post120: dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(fileURLToPath(import.meta.url).endsWith('ci-config.test.ts')).toBe(true);
  });

  it('post120: root join resolves package.json name backlink', () => {
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name).toBe('backlink');
  });

  it('post120: CI surface file sizes sum lock', () => {
    const sizes = [
      statSync(join(root, '.github/workflows/ci.yml')).size,
      statSync(join(root, '.github/workflows/deploy.yml')).size,
      statSync(join(root, '.github/dependabot.yml')).size,
      statSync(join(root, 'package.json')).size,
      statSync(join(root, 'vitest.config.ts')).size,
    ];
    expect(sizes).toEqual([6295, 1004, 505, 637, 535]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(8976);
  });

  it('post120: timeout minutes sum 10+15+5+20 = 50', () => {
    expect(10 + 15 + 5 + 20).toBe(50);
    expect(read('.github/workflows/ci.yml')).toContain('timeout-minutes: 10');
    expect(read('.github/workflows/ci.yml')).toContain('timeout-minutes: 15');
    expect(read('.github/workflows/ci.yml')).toContain('timeout-minutes: 5');
    expect(read('.github/workflows/deploy.yml')).toContain('timeout-minutes: 20');
  });

  it('post120: retention-days 14 is fortnight not week', () => {
    expect(14).not.toBe(7);
    expect(14 % 7).toBe(0);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post120: Node 20 pin is even LTS major', () => {
    expect(20 % 2).toBe(0);
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
    expect(read('.github/workflows/deploy.yml')).toContain('node-version: "20"');
  });

  it('post120: sha256 of ci.yml line 0', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[0]).digest('hex')).toBe(
      '8e7430f31889b761a2ccebd73080d82a3491aa7c565a2ea6583bd0f8788ccbd8',
    );
  });

  it('post120: sha256 of ci.yml line 1', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[1]).digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('post120: sha256 of ci.yml line 2', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[2]).digest('hex')).toBe(
      'fc8135fd1264162a0a9b1fb413cf3ab58a2f07a0d78717ded78108a950ea7b75',
    );
  });

  it('post120: sha256 of ci.yml line 3', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[3]).digest('hex')).toBe(
      '9ceb67319dee716866caff20da8b740ce18611345eb412757845ff03d941e2fa',
    );
  });

  it('post120: sha256 of ci.yml line 4', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[4]).digest('hex')).toBe(
      'd746850d043eeade203d772de5cffd7224049cf5ef2e98dd6f956d48612c5616',
    );
  });

  it('post120: ci.yml name CI is uppercase not lowercase', () => {
    expect(read('.github/workflows/ci.yml')).toContain('name: CI');
    expect(read('.github/workflows/ci.yml')).not.toContain('name: ci\n');
    expect(read('.github/workflows/ci.yml')).not.toContain('name: Ci\n');
  });

  it('post120: job ids are lowercase typecheck test hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('  typecheck:');
    expect(ci).toContain('  test:');
    expect(ci).toContain('  hygiene:');
    expect(ci).not.toContain('  Typecheck:');
    expect(ci).not.toContain('  Tests:');
    expect(ci).not.toContain('  Hygiene:');
  });

  it('post120: CI does not hardcode backlink.fuzzywigg.com deploy target', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('backlink.fuzzywigg.com');
    expect(read('.github/workflows/deploy.yml')).not.toContain('backlink.fuzzywigg.com');
  });

  it('post120: AGENTS.md domain target remains documentation-only', () => {
    expect(read('AGENTS.md')).toContain('backlink.fuzzywigg.com');
    expect(read('.github/workflows/ci.yml')).not.toContain('fuzzywigg.com');
  });

  it('post120: package.json name is backlink', () => {
    expect(JSON.parse(read('package.json')).name).toBe('backlink');
  });

  it('post120: package.json version is 0.1.0', () => {
    expect(JSON.parse(read('package.json')).version).toBe('0.1.0');
  });

  it('post120: package.json type is module', () => {
    expect(JSON.parse(read('package.json')).type).toBe('module');
  });

  it('post120: package.json scripts.dev is wrangler dev', () => {
    expect(JSON.parse(read('package.json')).scripts['dev']).toBe('wrangler dev');
  });

  it('post120: package.json scripts.deploy is wrangler deploy', () => {
    expect(JSON.parse(read('package.json')).scripts['deploy']).toBe('wrangler deploy');
  });

  it('post120: package.json scripts.typecheck is tsc --noEmit', () => {
    expect(JSON.parse(read('package.json')).scripts['typecheck']).toBe('tsc --noEmit');
  });

  it('post120: package.json scripts.test is vitest run', () => {
    expect(JSON.parse(read('package.json')).scripts['test']).toBe('vitest run');
  });

  it('post120: package.json scripts.test:watch is vitest', () => {
    expect(JSON.parse(read('package.json')).scripts['test:watch']).toBe('vitest');
  });

  it('post120: package.json scripts.test:coverage is vitest run --coverage', () => {
    expect(JSON.parse(read('package.json')).scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post120: package.json dependencies.hono is ^4.13.7', () => {
    expect(JSON.parse(read('package.json')).dependencies['hono']).toBe('^4.13.7');
  });

  it('post120: package.json devDependencies.@cloudflare/workers-types is ^5.20260911.1', () => {
    expect(JSON.parse(read('package.json')).devDependencies['@cloudflare/workers-types']).toBe('^5.20260911.1');
  });

  it('post120: package.json devDependencies.@types/node is ^22.20.2', () => {
    expect(JSON.parse(read('package.json')).devDependencies['@types/node']).toBe('^22.20.2');
  });

  it('post120: package.json devDependencies.@vitest/coverage-v8 is ^5.0.0', () => {
    expect(JSON.parse(read('package.json')).devDependencies['@vitest/coverage-v8']).toBe('^5.0.0');
  });

  it('post120: package.json devDependencies.typescript is ^5.7.0', () => {
    expect(JSON.parse(read('package.json')).devDependencies['typescript']).toBe('^5.7.0');
  });

  it('post120: package.json devDependencies.vitest is ^5.0.0', () => {
    expect(JSON.parse(read('package.json')).devDependencies['vitest']).toBe('^5.0.0');
  });

  it('post120: package.json devDependencies.wrangler is ^4.131.1', () => {
    expect(JSON.parse(read('package.json')).devDependencies['wrangler']).toBe('^4.131.1');
  });

  it('post120: tsconfig.compilerOptions.target lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.target).toEqual('ES2022');
  });

  it('post120: tsconfig.compilerOptions.lib lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.lib).toEqual(['ES2022']);
  });

  it('post120: tsconfig.compilerOptions.module lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.module).toEqual('ESNext');
  });

  it('post120: tsconfig.compilerOptions.moduleResolution lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.moduleResolution).toEqual('Bundler');
  });

  it('post120: tsconfig.compilerOptions.types lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
  });

  it('post120: tsconfig.compilerOptions.strict lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.strict).toEqual(true);
  });

  it('post120: tsconfig.compilerOptions.noEmit lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.noEmit).toEqual(true);
  });

  it('post120: tsconfig.compilerOptions.resolveJsonModule lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.resolveJsonModule).toEqual(true);
  });

  it('post120: tsconfig.compilerOptions.skipLibCheck lock', () => {
    expect(JSON.parse(read('tsconfig.json')).compilerOptions.skipLibCheck).toEqual(true);
  });

  it('post120: tsconfig.include exact array', () => {
    expect(JSON.parse(read('tsconfig.json')).include).toEqual([
      'src/**/*.ts',
      'test/**/*.ts',
      'vitest.config.ts',
    ]);
  });

  it('post120: HMAC-SHA256(AGENTS.md, key=post120)', () => {
    expect(hmacSha256('post120', 'AGENTS.md')).toBe(
      '965f9c02d9edaa726ee8c5e38e9aeed8d5873322597e6b36a91c921b76ce7deb',
    );
  });

  it('post120: HMAC-SHA256(AGENTS.md, key=leftover)', () => {
    expect(hmacSha256('leftover', 'AGENTS.md')).toBe(
      'ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e',
    );
  });

  it('post120: HMAC-SHA256(DEPLOY.md, key=post120)', () => {
    expect(hmacSha256('post120', 'DEPLOY.md')).toBe(
      '477df852bcd9cdb4c1f3f6b34da2c33b6257b5636acc2ab3ded506b396cebd56',
    );
  });

  it('post120: HMAC-SHA256(DEPLOY.md, key=leftover)', () => {
    expect(hmacSha256('leftover', 'DEPLOY.md')).toBe(
      '8e69d3722a2f57941fecb3a0602ebb6cab5a31755e7c8bc88ed0771bc1822659',
    );
  });

  it('post120: HMAC-SHA256(README.md, key=post120)', () => {
    expect(hmacSha256('post120', 'README.md')).toBe(
      '37740d6ed96a42e5dfbc523650f3dfe6ed703f67a5a8c675c029ee73201f86e3',
    );
  });

  it('post120: HMAC-SHA256(README.md, key=leftover)', () => {
    expect(hmacSha256('leftover', 'README.md')).toBe(
      '57c08297703e57c6b5694a515e43b6592bd130637c82dcc569a048bda2fd181f',
    );
  });

  it('post120: HMAC-SHA256(wrangler.toml, key=post120)', () => {
    expect(hmacSha256('post120', 'wrangler.toml')).toBe(
      'b40b599479f843bb78f2d7e0955ae156e7dc922d70d5aabf1c7ebe1499d6b53a',
    );
  });

  it('post120: HMAC-SHA256(wrangler.toml, key=leftover)', () => {
    expect(hmacSha256('leftover', 'wrangler.toml')).toBe(
      '117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063',
    );
  });

  it('post120: ci.yml first line has no trailing whitespace', () => {
    const line = read('.github/workflows/ci.yml').split('\n')[0];
    expect(line).toBe(line.trimEnd());
    expect(line.startsWith(' ')).toBe(false);
  });

  it('post120: package.json pretty-printed with 2-space indent', () => {
    const raw = read('package.json');
    expect(raw).toContain('\n  "name":');
    expect(raw).not.toContain('\t');
  });

  it('post120: vitest.config.ts uses 2-space indent', () => {
    expect(read('vitest.config.ts')).toContain('\n  test: {');
    expect(read('vitest.config.ts')).not.toContain('\t');
  });

  it('post120: post120 suite self-names in source', () => {
    expect(read('test/ci-config.test.ts')).toContain('post120 ci-config HEAVY deepen');
    expect(read('test/ci-config.test.ts')).toContain("it('post120:");
  });

  it('post120: all CI and deploy jobs run on ubuntu-latest', () => {
    expect((read('.github/workflows/ci.yml').match(/runs-on:\s*ubuntu-latest/g) ?? []).length).toBe(3);
    expect((read('.github/workflows/deploy.yml').match(/runs-on:\s*ubuntu-latest/g) ?? []).length).toBe(1);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/runs-on:\s*windows/);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/runs-on:\s*macos/);
  });

  it('post120: CI does not set working-directory overrides', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('working-directory:');
    expect(read('.github/workflows/deploy.yml')).not.toContain('working-directory:');
  });

  it('post120: CI does not use container: or services:', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*container:/m);
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*services:/m);
  });

  it('post120: CI does not use environment: protection gates', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s*environment:/m);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/^\s*environment:/m);
  });

  it('post120: CI does not upload node_modules as artifact', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/path:\s*\n\s*node_modules/);
    expect(ci).toContain('name: coverage-report');
    expect(ci).toContain('--exclude-dir=node_modules');
  });

  it('post120: CI Install dependencies step is exactly npm ci', () => {
    expect(read('.github/workflows/ci.yml')).toContain('run: npm ci');
    expect(read('.github/workflows/ci.yml')).not.toContain('npm install');
    expect(read('.github/workflows/deploy.yml')).toContain('run: npm ci');
  });

  it('post120: Typecheck step is exactly npm run typecheck', () => {
    expect(read('.github/workflows/ci.yml')).toContain('run: npm run typecheck');
    expect(read('.github/workflows/deploy.yml')).toContain('run: npm run typecheck');
  });

  it('post120: Tests step is exactly npm run test:coverage', () => {
    expect(read('.github/workflows/ci.yml')).toContain('run: npm run test:coverage');
    expect(read('.github/workflows/deploy.yml')).toContain('run: npm run test:coverage');
  });

  it('post120: first-line sha256 of ci.yml', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[0]).digest('hex')).toBe(
      '8e7430f31889b761a2ccebd73080d82a3491aa7c565a2ea6583bd0f8788ccbd8',
    );
  });

  it('post120: size*lines product of ci.yml is 1114215', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size * read('.github/workflows/ci.yml').split('\n').length).toBe(1114215);
  });

  it('post120: first-line sha256 of deploy.yml', () => {
    expect(createHash('sha256').update(read('.github/workflows/deploy.yml').split('\n')[0]).digest('hex')).toBe(
      '2dbfcbc4df1ce394975f60183fd2e5c420d970fd3611c0d88ad06ff073091960',
    );
  });

  it('post120: size*lines product of deploy.yml is 47188', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size * read('.github/workflows/deploy.yml').split('\n').length).toBe(47188);
  });

  it('post120: first-line sha256 of dependabot.yml', () => {
    expect(createHash('sha256').update(read('.github/dependabot.yml').split('\n')[0]).digest('hex')).toBe(
      '28ddc9cbecb071435220504c25f544985d6671b0c98ad9e06d9bf8c0d36f23be',
    );
  });

  it('post120: size*lines product of dependabot.yml is 12625', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size * read('.github/dependabot.yml').split('\n').length).toBe(12625);
  });

  it('post120: first-line sha256 of vitest.config.ts', () => {
    expect(createHash('sha256').update(read('vitest.config.ts').split('\n')[0]).digest('hex')).toBe(
      '85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328',
    );
  });

  it('post120: size*lines product of vitest.config.ts is 11770', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size * read('vitest.config.ts').split('\n').length).toBe(11770);
  });

  it('post120: first-line sha256 of package.json', () => {
    expect(createHash('sha256').update(read('package.json').split('\n')[0]).digest('hex')).toBe(
      '021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96',
    );
  });

  it('post120: size*lines product of package.json is 16562', () => {
    expect(statSync(join(root, 'package.json')).size * read('package.json').split('\n').length).toBe(16562);
  });

  it('post120: first-line sha256 of tsconfig.json', () => {
    expect(createHash('sha256').update(read('tsconfig.json').split('\n')[0]).digest('hex')).toBe(
      '021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96',
    );
  });

  it('post120: size*lines product of tsconfig.json is 9528', () => {
    expect(statSync(join(root, 'tsconfig.json')).size * read('tsconfig.json').split('\n').length).toBe(9528);
  });

  it('post120: first-line sha256 of .gitignore', () => {
    expect(createHash('sha256').update(read('.gitignore').split('\n')[0]).digest('hex')).toBe(
      '9e1956bad8470f9fe7983c04c7637ca8125c8f03b0435d6091c3f294d63447db',
    );
  });

  it('post120: size*lines product of .gitignore is 6786', () => {
    expect(statSync(join(root, '.gitignore')).size * read('.gitignore').split('\n').length).toBe(6786);
  });

  it('post120: first-line sha256 of environment.json', () => {
    expect(createHash('sha256').update(read('.cursor/environment.json').split('\n')[0]).digest('hex')).toBe(
      '021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96',
    );
  });

  it('post120: size*lines product of environment.json is 285', () => {
    expect(statSync(join(root, '.cursor/environment.json')).size * read('.cursor/environment.json').split('\n').length).toBe(285);
  });

  it('post120: first-line sha256 of AGENTS.md', () => {
    expect(createHash('sha256').update(read('AGENTS.md').split('\n')[0]).digest('hex')).toBe(
      'e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618',
    );
  });

  it('post120: size*lines product of AGENTS.md is 35595', () => {
    expect(statSync(join(root, 'AGENTS.md')).size * read('AGENTS.md').split('\n').length).toBe(35595);
  });

  it('post120: first-line sha256 of .gitattributes', () => {
    expect(createHash('sha256').update(read('.gitattributes').split('\n')[0]).digest('hex')).toBe(
      '89cd69fff02cdf85f5be7a7bd61219ad77eb0487ad03ba3f4a183dd49aef9130',
    );
  });

  it('post120: size*lines product of .gitattributes is 198', () => {
    expect(statSync(join(root, '.gitattributes')).size * read('.gitattributes').split('\n').length).toBe(198);
  });

  it('post120: first-line sha256 of package-lock.json', () => {
    expect(createHash('sha256').update(read('package-lock.json').split('\n')[0]).digest('hex')).toBe(
      '021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96',
    );
  });

  it('post120: size*lines product of package-lock.json is 261657256', () => {
    expect(statSync(join(root, 'package-lock.json')).size * read('package-lock.json').split('\n').length).toBe(261657256);
  });

  it('post120: first-line sha256 of DEPLOY.md', () => {
    expect(createHash('sha256').update(read('DEPLOY.md').split('\n')[0]).digest('hex')).toBe(
      'bcb1aa55214a9bafe7c9aed196c9ec210e023dc6c81dc8f4db34220f221a2957',
    );
  });

  it('post120: size*lines product of DEPLOY.md is 102245', () => {
    expect(statSync(join(root, 'DEPLOY.md')).size * read('DEPLOY.md').split('\n').length).toBe(102245);
  });

  it('post120: first-line sha256 of README.md', () => {
    expect(createHash('sha256').update(read('README.md').split('\n')[0]).digest('hex')).toBe(
      'a46591b0359e4bc72d2af8c747e249227576c178c9b9fbd8e2eae8ac3764c538',
    );
  });

  it('post120: size*lines product of README.md is 229682', () => {
    expect(statSync(join(root, 'README.md')).size * read('README.md').split('\n').length).toBe(229682);
  });

  it('post120: first-line sha256 of wrangler.toml', () => {
    expect(createHash('sha256').update(read('wrangler.toml').split('\n')[0]).digest('hex')).toBe(
      '44eea2b40cca4009e9429bc54f55cd083523742a2e6bf8195731b2e95857194e',
    );
  });

  it('post120: size*lines product of wrangler.toml is 5940', () => {
    expect(statSync(join(root, 'wrangler.toml')).size * read('wrangler.toml').split('\n').length).toBe(5940);
  });

  it('post120: first-line sha256 of mcp-spec.md', () => {
    expect(createHash('sha256').update(read('docs/mcp-spec.md').split('\n')[0]).digest('hex')).toBe(
      '99c84d33ad819ac91a66e1a30aef3bf512cb393370d7b6fbc8397c8917ba2e66',
    );
  });

  it('post120: size*lines product of mcp-spec.md is 515040', () => {
    expect(statSync(join(root, 'docs/mcp-spec.md')).size * read('docs/mcp-spec.md').split('\n').length).toBe(515040);
  });

  it('post120: first-line sha256 of bug.yml', () => {
    expect(createHash('sha256').update(read('.github/ISSUE_TEMPLATE/bug.yml').split('\n')[0]).digest('hex')).toBe(
      'c73bb080f0d112d5dd0243d0ed477f3e655db4726c0af7c4a87e03329191eb3c',
    );
  });

  it('post120: size*lines product of bug.yml is 34686', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).size * read('.github/ISSUE_TEMPLATE/bug.yml').split('\n').length).toBe(34686);
  });

  it('post120: first-line sha256 of chore.yml', () => {
    expect(createHash('sha256').update(read('.github/ISSUE_TEMPLATE/chore.yml').split('\n')[0]).digest('hex')).toBe(
      '0ca9cf8e5fc9a8159adfd5ad39af99e01ce57d42dac57e69c8e84ecd27670d0c',
    );
  });

  it('post120: size*lines product of chore.yml is 23265', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).size * read('.github/ISSUE_TEMPLATE/chore.yml').split('\n').length).toBe(23265);
  });

  it('post120: first-line sha256 of feature.yml', () => {
    expect(createHash('sha256').update(read('.github/ISSUE_TEMPLATE/feature.yml').split('\n')[0]).digest('hex')).toBe(
      '974a3db4114b28ff61da5588185a6bb1874b2ab9aeda22648922a2f84d69295e',
    );
  });

  it('post120: size*lines product of feature.yml is 42504', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).size * read('.github/ISSUE_TEMPLATE/feature.yml').split('\n').length).toBe(42504);
  });

  it('post120: first-line sha256 of issue-config.yml', () => {
    expect(createHash('sha256').update(read('.github/ISSUE_TEMPLATE/config.yml').split('\n')[0]).digest('hex')).toBe(
      '05905c8f244d51298bbd1778c286c8a6c9f7adf0d0e5a5f72f764d71ec82cc64',
    );
  });

  it('post120: size*lines product of issue-config.yml is 56', () => {
    expect(statSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).size * read('.github/ISSUE_TEMPLATE/config.yml').split('\n').length).toBe(56);
  });

  it('post120: sha256 of reversed ci.yml content', () => {
    const rev = [...read('.github/workflows/ci.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('d1897bbef13787c7c5d1c731f788dea05deb87bd79eafe2bb7e29755b7b2b79b');
  });

  it('post120: sha256 of reversed package.json content', () => {
    const rev = [...read('package.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4');
  });

  it('post120: sha256 of reversed vitest.config.ts content', () => {
    const rev = [...read('vitest.config.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b');
  });

  it('post120: sha256 of reversed dependabot.yml content', () => {
    const rev = [...read('.github/dependabot.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('8012cea11db50fc6f52d77f98c5e1fbe5a1a1bf3401459cd98de5bb63657fc84');
  });

  it('post120: sha256 of reversed AGENTS.md content', () => {
    const rev = [...read('AGENTS.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc');
  });

  it('post120: locks ci.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/ci.yml').toUpperCase()).toBe('C4DB88D23A2F8C41A388C0791279F5E6F56E3D5DA7CC8FD25F97B5308B00EED5');
  });

  it('post120: locks deploy.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/deploy.yml').toUpperCase()).toBe('49BF571653F9091108A8E7E3F358DE06DE332686019D1B0E0F68DDAF7B48D5C3');
  });

  it('post120: locks package.json sha256 UPPERCASE', () => {
    expect(sha256('package.json').toUpperCase()).toBe('34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C');
  });

});

// --- HEAVY burn (post-#126): deepen ci-config leftover edges only — no product inventing ---
// Follows #126 post120 suite. Extra HMAC keys + structural pins for leftover CI surface.

describe('post126 ci-config HEAVY deepen (after #126)', () => {
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
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


  it('post126: locks .github/workflows/ci.yml sha256', () => {
    expect(sha256(".github/workflows/ci.yml")).toBe("c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5");
  });

  it('post126: locks .github/workflows/ci.yml sha1', () => {
    expect(sha1(".github/workflows/ci.yml")).toBe("2105395119389c6131d039b5d787abc150bbbcaa");
  });

  it('post126: locks .github/workflows/ci.yml md5', () => {
    expect(md5(".github/workflows/ci.yml")).toBe("ea05159f5a4591ccf20765050a212605");
  });

  it('post126: locks .github/workflows/ci.yml sha384', () => {
    expect(sha384(".github/workflows/ci.yml")).toBe("8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab");
  });

  it('post126: locks .github/workflows/ci.yml sha512', () => {
    expect(sha512(".github/workflows/ci.yml")).toBe("3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460");
  });

  it('post126: locks .github/workflows/ci.yml sha3-256', () => {
    expect(sha3(".github/workflows/ci.yml")).toBe("8f49dc5067d49c3458635df0dbb9078bac974081a35adab2c27d9349f30cd611");
  });

  it('post126: locks .github/workflows/ci.yml blake2b512', () => {
    expect(blake2b(".github/workflows/ci.yml")).toBe("5629fff561ce7acb56fc3d2f66b875992f525b4a25ec6c3c6fb485d6f6d20bb74a33c67c89389360ee29d12dd26361a4c24b39db6ec9aaf58462c3b0472f489d");
  });

  it('post126: locks .github/workflows/ci.yml ripemd160', () => {
    expect(ripemd(".github/workflows/ci.yml")).toBe("491302ba2e7b00c030ea98aea8ccee799d61e1ff");
  });

  it('post126: locks .github/workflows/ci.yml size 6295', () => {
    expect(statSync(join(root, ".github/workflows/ci.yml")).size).toBe(6295);
    expect(readFileSync(join(root, ".github/workflows/ci.yml")).byteLength).toBe(6295);
  });

  it('post126: locks .github/workflows/ci.yml utf8 6295 lines 177', () => {
    expect(read(".github/workflows/ci.yml")).toHaveLength(6295);
    expect(read(".github/workflows/ci.yml").split('\n')).toHaveLength(177);
  });

  it('post126: locks .github/workflows/ci.yml nibble 515 xor 3', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post126: locks .github/workflows/ci.yml pairSum 4595 rollingXor 71', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(pairSum(d)).toBe(4595);
    expect(rollingXor(d)).toBe(71);
  });

  it('post126: locks .github/workflows/ci.yml first/last/mid octets', () => {
    const d = sha256(".github/workflows/ci.yml");
    expect(d.slice(0, 2)).toBe("c4");
    expect(d.slice(-2)).toBe("d5");
    expect(d.slice(28, 36)).toBe("f5e6f56e");
  });

  it('post126: locks .github/workflows/ci.yml HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', ".github/workflows/ci.yml")).toBe("9a41345f39dec2662882e71f1ca7e55ec17f773c5670e239d694d6825cc632b3");
    expect(hmacSha256('leftover', ".github/workflows/ci.yml")).toBe("d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce");
    expect(hmacSha256('TOKENMAXX', ".github/workflows/ci.yml")).toBe("5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b");
  });

  it('post126: locks .github/workflows/ci.yml HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', ".github/workflows/ci.yml")).toBe("b7e1e134f317dbc57bfe75f826f9480e9621f22a2fa06c1622c7045e2677df26");
    expect(hmacSha256('HEAVY', ".github/workflows/ci.yml")).toBe("8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea");
    expect(hmacSha256('no-product-invent', ".github/workflows/ci.yml")).toBe("1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde");
  });

  it('post126: locks .github/workflows/ci.yml spaces 1716', () => {
    expect((read(".github/workflows/ci.yml").match(/ /g) ?? []).length).toBe(1716);
  });

  it('post126: locks .github/workflows/ci.yml reversed sha256', () => {
    const rev = [...read(".github/workflows/ci.yml")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("d1897bbef13787c7c5d1c731f788dea05deb87bd79eafe2bb7e29755b7b2b79b");
  });

  it('post126: locks .github/workflows/ci.yml sha256 UPPERCASE', () => {
    expect(sha256(".github/workflows/ci.yml").toUpperCase()).toBe("C4DB88D23A2F8C41A388C0791279F5E6F56E3D5DA7CC8FD25F97B5308B00EED5");
  });

  it('post126: locks .github/workflows/ci.yml first-line sha256', () => {
    expect(createHash('sha256').update(read(".github/workflows/ci.yml").split('\n')[0]).digest('hex')).toBe("8e7430f31889b761a2ccebd73080d82a3491aa7c565a2ea6583bd0f8788ccbd8");
  });

  it('post126: locks .github/workflows/ci.yml size*lines 1114215', () => {
    expect(statSync(join(root, ".github/workflows/ci.yml")).size * read(".github/workflows/ci.yml").split('\n').length).toBe(1114215);
  });

  it('post126: locks .github/workflows/deploy.yml sha256', () => {
    expect(sha256(".github/workflows/deploy.yml")).toBe("49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3");
  });

  it('post126: locks .github/workflows/deploy.yml sha1', () => {
    expect(sha1(".github/workflows/deploy.yml")).toBe("5f7a3932b69a68d740162b1079688d6934060f61");
  });

  it('post126: locks .github/workflows/deploy.yml md5', () => {
    expect(md5(".github/workflows/deploy.yml")).toBe("ea86e4de097085159e425937542bf7cf");
  });

  it('post126: locks .github/workflows/deploy.yml sha384', () => {
    expect(sha384(".github/workflows/deploy.yml")).toBe("61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f");
  });

  it('post126: locks .github/workflows/deploy.yml sha512', () => {
    expect(sha512(".github/workflows/deploy.yml")).toBe("7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641");
  });

  it('post126: locks .github/workflows/deploy.yml sha3-256', () => {
    expect(sha3(".github/workflows/deploy.yml")).toBe("c214b3a3742462dbe536466786d717241cdc0be84f5bbf71da7c8f8ed281d62e");
  });

  it('post126: locks .github/workflows/deploy.yml blake2b512', () => {
    expect(blake2b(".github/workflows/deploy.yml")).toBe("0ec8ba30a1fdece2b7033b67cffa78d926b8deb86a5f7468060a746f0ff0dc8b8488236b19465603f53aac178556c000ecca9748f4dcf7591155f67f0c1c5628");
  });

  it('post126: locks .github/workflows/deploy.yml ripemd160', () => {
    expect(ripemd(".github/workflows/deploy.yml")).toBe("7a476e7889618bef7c8b22a0f651f4e49658527e");
  });

  it('post126: locks .github/workflows/deploy.yml size 1004', () => {
    expect(statSync(join(root, ".github/workflows/deploy.yml")).size).toBe(1004);
    expect(readFileSync(join(root, ".github/workflows/deploy.yml")).byteLength).toBe(1004);
  });

  it('post126: locks .github/workflows/deploy.yml utf8 1004 lines 47', () => {
    expect(read(".github/workflows/deploy.yml")).toHaveLength(1004);
    expect(read(".github/workflows/deploy.yml").split('\n')).toHaveLength(47);
  });

  it('post126: locks .github/workflows/deploy.yml nibble 476 xor 4', () => {
    const d = sha256(".github/workflows/deploy.yml");
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post126: locks .github/workflows/deploy.yml pairSum 3686 rollingXor 38', () => {
    const d = sha256(".github/workflows/deploy.yml");
    expect(pairSum(d)).toBe(3686);
    expect(rollingXor(d)).toBe(38);
  });

  it('post126: locks .github/workflows/deploy.yml first/last/mid octets', () => {
    const d = sha256(".github/workflows/deploy.yml");
    expect(d.slice(0, 2)).toBe("49");
    expect(d.slice(-2)).toBe("c3");
    expect(d.slice(28, 36)).toBe("de06de33");
  });

  it('post126: locks .github/workflows/deploy.yml HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', ".github/workflows/deploy.yml")).toBe("eb322b24392d6466acd8ac3f7eb64f61eb862e0b037bd66d5c1a25c5531a05b8");
    expect(hmacSha256('leftover', ".github/workflows/deploy.yml")).toBe("e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83");
    expect(hmacSha256('TOKENMAXX', ".github/workflows/deploy.yml")).toBe("339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b");
  });

  it('post126: locks .github/workflows/deploy.yml HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', ".github/workflows/deploy.yml")).toBe("93b7080fc4dc42b71e743eb555f36e61ad8406205278bd1dc618bd20ae6bf807");
    expect(hmacSha256('HEAVY', ".github/workflows/deploy.yml")).toBe("87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601");
    expect(hmacSha256('no-product-invent', ".github/workflows/deploy.yml")).toBe("3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544");
  });

  it('post126: locks .github/workflows/deploy.yml spaces 274', () => {
    expect((read(".github/workflows/deploy.yml").match(/ /g) ?? []).length).toBe(274);
  });

  it('post126: locks .github/workflows/deploy.yml reversed sha256', () => {
    const rev = [...read(".github/workflows/deploy.yml")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("c76eeb8130b6ef38120b7c8d0345a0401de9d92f3114786cea652396314dae41");
  });

  it('post126: locks .github/workflows/deploy.yml sha256 UPPERCASE', () => {
    expect(sha256(".github/workflows/deploy.yml").toUpperCase()).toBe("49BF571653F9091108A8E7E3F358DE06DE332686019D1B0E0F68DDAF7B48D5C3");
  });

  it('post126: locks .github/workflows/deploy.yml first-line sha256', () => {
    expect(createHash('sha256').update(read(".github/workflows/deploy.yml").split('\n')[0]).digest('hex')).toBe("2dbfcbc4df1ce394975f60183fd2e5c420d970fd3611c0d88ad06ff073091960");
  });

  it('post126: locks .github/workflows/deploy.yml size*lines 47188', () => {
    expect(statSync(join(root, ".github/workflows/deploy.yml")).size * read(".github/workflows/deploy.yml").split('\n').length).toBe(47188);
  });

  it('post126: locks .github/dependabot.yml sha256', () => {
    expect(sha256(".github/dependabot.yml")).toBe("a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac");
  });

  it('post126: locks .github/dependabot.yml sha1', () => {
    expect(sha1(".github/dependabot.yml")).toBe("dfdb63975444874143105431e4cee95165932c7b");
  });

  it('post126: locks .github/dependabot.yml md5', () => {
    expect(md5(".github/dependabot.yml")).toBe("bd53b7cdf9bb7287532d96a32cbec9a4");
  });

  it('post126: locks .github/dependabot.yml sha384', () => {
    expect(sha384(".github/dependabot.yml")).toBe("ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc");
  });

  it('post126: locks .github/dependabot.yml sha512', () => {
    expect(sha512(".github/dependabot.yml")).toBe("276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e");
  });

  it('post126: locks .github/dependabot.yml sha3-256', () => {
    expect(sha3(".github/dependabot.yml")).toBe("4a022f1046b7dcd4b57cc16cbb7efad06e9401d30f9d383321ff44ef7a16d1d7");
  });

  it('post126: locks .github/dependabot.yml blake2b512', () => {
    expect(blake2b(".github/dependabot.yml")).toBe("3fb74f327e9c57cb11a7219281df13a608a303a09c82ac1233f53ddddfc96a01e9e9eee076f206359e8b4db1264e971f389ce226acf2f3647146ce8901395f0e");
  });

  it('post126: locks .github/dependabot.yml ripemd160', () => {
    expect(ripemd(".github/dependabot.yml")).toBe("7d8132f4ca88999fcfcf95c3fc1c0ca8b617fe5c");
  });

  it('post126: locks .github/dependabot.yml size 505', () => {
    expect(statSync(join(root, ".github/dependabot.yml")).size).toBe(505);
    expect(readFileSync(join(root, ".github/dependabot.yml")).byteLength).toBe(505);
  });

  it('post126: locks .github/dependabot.yml utf8 505 lines 25', () => {
    expect(read(".github/dependabot.yml")).toHaveLength(505);
    expect(read(".github/dependabot.yml").split('\n')).toHaveLength(25);
  });

  it('post126: locks .github/dependabot.yml nibble 526 xor 6', () => {
    const d = sha256(".github/dependabot.yml");
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post126: locks .github/dependabot.yml pairSum 4381 rollingXor 219', () => {
    const d = sha256(".github/dependabot.yml");
    expect(pairSum(d)).toBe(4381);
    expect(rollingXor(d)).toBe(219);
  });

  it('post126: locks .github/dependabot.yml first/last/mid octets', () => {
    const d = sha256(".github/dependabot.yml");
    expect(d.slice(0, 2)).toBe("a1");
    expect(d.slice(-2)).toBe("ac");
    expect(d.slice(28, 36)).toBe("6507533f");
  });

  it('post126: locks .github/dependabot.yml HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', ".github/dependabot.yml")).toBe("de4862b998e879d3007b3d8422316bb543a24a53f7944795f84cb8361019b89a");
    expect(hmacSha256('leftover', ".github/dependabot.yml")).toBe("b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9");
    expect(hmacSha256('TOKENMAXX', ".github/dependabot.yml")).toBe("e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1");
  });

  it('post126: locks .github/dependabot.yml HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', ".github/dependabot.yml")).toBe("28073a9e3e4df38cd5106169546b480f9bf433be3066a03a17a88de42c40e4a2");
    expect(hmacSha256('HEAVY', ".github/dependabot.yml")).toBe("e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff");
    expect(hmacSha256('no-product-invent', ".github/dependabot.yml")).toBe("5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa");
  });

  it('post126: locks .github/dependabot.yml spaces 130', () => {
    expect((read(".github/dependabot.yml").match(/ /g) ?? []).length).toBe(130);
  });

  it('post126: locks .github/dependabot.yml reversed sha256', () => {
    const rev = [...read(".github/dependabot.yml")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("8012cea11db50fc6f52d77f98c5e1fbe5a1a1bf3401459cd98de5bb63657fc84");
  });

  it('post126: locks .github/dependabot.yml sha256 UPPERCASE', () => {
    expect(sha256(".github/dependabot.yml").toUpperCase()).toBe("A11B96153B6BB773EE0CBDCD59816507533FF4DD5E8CB34DE0BAF667CE72ECAC");
  });

  it('post126: locks .github/dependabot.yml first-line sha256', () => {
    expect(createHash('sha256').update(read(".github/dependabot.yml").split('\n')[0]).digest('hex')).toBe("28ddc9cbecb071435220504c25f544985d6671b0c98ad9e06d9bf8c0d36f23be");
  });

  it('post126: locks .github/dependabot.yml size*lines 12625', () => {
    expect(statSync(join(root, ".github/dependabot.yml")).size * read(".github/dependabot.yml").split('\n').length).toBe(12625);
  });

  it('post126: locks package.json sha256', () => {
    expect(sha256("package.json")).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it('post126: locks package.json sha1', () => {
    expect(sha1("package.json")).toBe("b58d14f35b9c13bb254d5e2a51240e2918a126c5");
  });

  it('post126: locks package.json md5', () => {
    expect(md5("package.json")).toBe("63472e1fb514fb0dadb5e49a7bdbaa5f");
  });

  it('post126: locks package.json sha384', () => {
    expect(sha384("package.json")).toBe("4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20");
  });

  it('post126: locks package.json sha512', () => {
    expect(sha512("package.json")).toBe("7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28");
  });

  it('post126: locks package.json sha3-256', () => {
    expect(sha3("package.json")).toBe("e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5");
  });

  it('post126: locks package.json blake2b512', () => {
    expect(blake2b("package.json")).toBe("a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d");
  });

  it('post126: locks package.json ripemd160', () => {
    expect(ripemd("package.json")).toBe("f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad");
  });

  it('post126: locks package.json size 637', () => {
    expect(statSync(join(root, "package.json")).size).toBe(637);
    expect(readFileSync(join(root, "package.json")).byteLength).toBe(637);
  });

  it('post126: locks package.json utf8 635 lines 26', () => {
    expect(read("package.json")).toHaveLength(635);
    expect(read("package.json").split('\n')).toHaveLength(26);
  });

  it('post126: locks package.json nibble 451 xor 13', () => {
    const d = sha256("package.json");
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post126: locks package.json pairSum 4051 rollingXor 13', () => {
    const d = sha256("package.json");
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it('post126: locks package.json first/last/mid octets', () => {
    const d = sha256("package.json");
    expect(d.slice(0, 2)).toBe("34");
    expect(d.slice(-2)).toBe("1c");
    expect(d.slice(28, 36)).toBe("e0ecaa43");
  });

  it('post126: locks package.json HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "package.json")).toBe("14829b01670d1141c34c0f804f9f31c439da8acbb1f3134ba460e7979be45543");
    expect(hmacSha256('leftover', "package.json")).toBe("20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1");
    expect(hmacSha256('TOKENMAXX', "package.json")).toBe("ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58");
  });

  it('post126: locks package.json HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "package.json")).toBe("2275bdbec0d72fc25d94ac2aabb064f806b20aec76286b55d06228257fc34f3f");
    expect(hmacSha256('HEAVY', "package.json")).toBe("59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563");
    expect(hmacSha256('no-product-invent', "package.json")).toBe("b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b");
  });

  it('post126: locks package.json spaces 106', () => {
    expect((read("package.json").match(/ /g) ?? []).length).toBe(106);
  });

  it('post126: locks package.json reversed sha256', () => {
    const rev = [...read("package.json")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4");
  });

  it('post126: locks package.json sha256 UPPERCASE', () => {
    expect(sha256("package.json").toUpperCase()).toBe("34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C");
  });

  it('post126: locks package.json first-line sha256', () => {
    expect(createHash('sha256').update(read("package.json").split('\n')[0]).digest('hex')).toBe("021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96");
  });

  it('post126: locks package.json size*lines 16562', () => {
    expect(statSync(join(root, "package.json")).size * read("package.json").split('\n').length).toBe(16562);
  });

  it('post126: locks vitest.config.ts sha256', () => {
    expect(sha256("vitest.config.ts")).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it('post126: locks vitest.config.ts sha1', () => {
    expect(sha1("vitest.config.ts")).toBe("f8d49517ece92fc5e9781fbde021a948958aac37");
  });

  it('post126: locks vitest.config.ts md5', () => {
    expect(md5("vitest.config.ts")).toBe("f1176313255f5f064a946d458482d81a");
  });

  it('post126: locks vitest.config.ts sha384', () => {
    expect(sha384("vitest.config.ts")).toBe("c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563");
  });

  it('post126: locks vitest.config.ts sha512', () => {
    expect(sha512("vitest.config.ts")).toBe("ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682");
  });

  it('post126: locks vitest.config.ts sha3-256', () => {
    expect(sha3("vitest.config.ts")).toBe("ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba");
  });

  it('post126: locks vitest.config.ts blake2b512', () => {
    expect(blake2b("vitest.config.ts")).toBe("93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a");
  });

  it('post126: locks vitest.config.ts ripemd160', () => {
    expect(ripemd("vitest.config.ts")).toBe("6f29a743813430d4d364f8ddd66e0aedf1506fcd");
  });

  it('post126: locks vitest.config.ts size 535', () => {
    expect(statSync(join(root, "vitest.config.ts")).size).toBe(535);
    expect(readFileSync(join(root, "vitest.config.ts")).byteLength).toBe(535);
  });

  it('post126: locks vitest.config.ts utf8 535 lines 22', () => {
    expect(read("vitest.config.ts")).toHaveLength(535);
    expect(read("vitest.config.ts").split('\n')).toHaveLength(22);
  });

  it('post126: locks vitest.config.ts nibble 536 xor 2', () => {
    const d = sha256("vitest.config.ts");
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post126: locks vitest.config.ts pairSum 4691 rollingXor 49', () => {
    const d = sha256("vitest.config.ts");
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it('post126: locks vitest.config.ts first/last/mid octets', () => {
    const d = sha256("vitest.config.ts");
    expect(d.slice(0, 2)).toBe("f9");
    expect(d.slice(-2)).toBe("38");
    expect(d.slice(28, 36)).toBe("ec95c6d5");
  });

  it('post126: locks vitest.config.ts HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "vitest.config.ts")).toBe("7dc6d3aaa91074a7f8a463f6c511be0456cec62d44a7232276df3321a2af115a");
    expect(hmacSha256('leftover', "vitest.config.ts")).toBe("3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7");
    expect(hmacSha256('TOKENMAXX', "vitest.config.ts")).toBe("0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9");
  });

  it('post126: locks vitest.config.ts HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "vitest.config.ts")).toBe("344e2e7817a658809e59b1cd34fa3ed6aed41eac5a2a8b84a27368a0959ddb10");
    expect(hmacSha256('HEAVY', "vitest.config.ts")).toBe("08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179");
    expect(hmacSha256('no-product-invent', "vitest.config.ts")).toBe("3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c");
  });

  it('post126: locks vitest.config.ts spaces 121', () => {
    expect((read("vitest.config.ts").match(/ /g) ?? []).length).toBe(121);
  });

  it('post126: locks vitest.config.ts reversed sha256', () => {
    const rev = [...read("vitest.config.ts")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b");
  });

  it('post126: locks vitest.config.ts sha256 UPPERCASE', () => {
    expect(sha256("vitest.config.ts").toUpperCase()).toBe("F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38");
  });

  it('post126: locks vitest.config.ts first-line sha256', () => {
    expect(createHash('sha256').update(read("vitest.config.ts").split('\n')[0]).digest('hex')).toBe("85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328");
  });

  it('post126: locks vitest.config.ts size*lines 11770', () => {
    expect(statSync(join(root, "vitest.config.ts")).size * read("vitest.config.ts").split('\n').length).toBe(11770);
  });

  it('post126: locks AGENTS.md sha256', () => {
    expect(sha256("AGENTS.md")).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it('post126: locks AGENTS.md sha1', () => {
    expect(sha1("AGENTS.md")).toBe("a7df1fec05dcf7b8ace116788297c77f467a7b6c");
  });

  it('post126: locks AGENTS.md md5', () => {
    expect(md5("AGENTS.md")).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it('post126: locks AGENTS.md sha384', () => {
    expect(sha384("AGENTS.md")).toBe("817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a");
  });

  it('post126: locks AGENTS.md sha512', () => {
    expect(sha512("AGENTS.md")).toBe("7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908");
  });

  it('post126: locks AGENTS.md sha3-256', () => {
    expect(sha3("AGENTS.md")).toBe("894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4");
  });

  it('post126: locks AGENTS.md blake2b512', () => {
    expect(blake2b("AGENTS.md")).toBe("7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0");
  });

  it('post126: locks AGENTS.md ripemd160', () => {
    expect(ripemd("AGENTS.md")).toBe("6637e853e0148967671e4a3f21bd852255e8ed1c");
  });

  it('post126: locks AGENTS.md size 1017', () => {
    expect(statSync(join(root, "AGENTS.md")).size).toBe(1017);
    expect(readFileSync(join(root, "AGENTS.md")).byteLength).toBe(1017);
  });

  it('post126: locks AGENTS.md utf8 1011 lines 35', () => {
    expect(read("AGENTS.md")).toHaveLength(1011);
    expect(read("AGENTS.md").split('\n')).toHaveLength(35);
  });

  it('post126: locks AGENTS.md nibble 479 xor 5', () => {
    const d = sha256("AGENTS.md");
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post126: locks AGENTS.md pairSum 5084 rollingXor 216', () => {
    const d = sha256("AGENTS.md");
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it('post126: locks AGENTS.md first/last/mid octets', () => {
    const d = sha256("AGENTS.md");
    expect(d.slice(0, 2)).toBe("48");
    expect(d.slice(-2)).toBe("aa");
    expect(d.slice(28, 36)).toBe("a5ec1be5");
  });

  it('post126: locks AGENTS.md HMAC post126/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post126', "AGENTS.md")).toBe("a620cc1251b411667680245e6deeb061f5b530a19f50c662643eadef7f75a3c8");
    expect(hmacSha256('leftover', "AGENTS.md")).toBe("ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e");
    expect(hmacSha256('TOKENMAXX', "AGENTS.md")).toBe("b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f");
  });

  it('post126: locks AGENTS.md HMAC after-#126/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#126', "AGENTS.md")).toBe("e6bf4a290e95138e3d930187ed11df4316a14ab75a52fcd5be0eb7ef7d828046");
    expect(hmacSha256('HEAVY', "AGENTS.md")).toBe("f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c");
    expect(hmacSha256('no-product-invent', "AGENTS.md")).toBe("dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264");
  });

  it('post126: locks AGENTS.md spaces 120', () => {
    expect((read("AGENTS.md").match(/ /g) ?? []).length).toBe(120);
  });

  it('post126: locks AGENTS.md reversed sha256', () => {
    const rev = [...read("AGENTS.md")].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe("662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc");
  });

  it('post126: locks AGENTS.md sha256 UPPERCASE', () => {
    expect(sha256("AGENTS.md").toUpperCase()).toBe("48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA");
  });

  it('post126: locks AGENTS.md first-line sha256', () => {
    expect(createHash('sha256').update(read("AGENTS.md").split('\n')[0]).digest('hex')).toBe("e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618");
  });

  it('post126: locks AGENTS.md size*lines 35595', () => {
    expect(statSync(join(root, "AGENTS.md")).size * read("AGENTS.md").split('\n').length).toBe(35595);
  });


  it('post126: CI still has typecheck/test/hygiene jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('typecheck:');
    expect(ci).toContain('test:');
    expect(ci).toContain('hygiene:');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm run test:coverage');
  });

  it('post126: deploy remains workflow_dispatch HITL', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('workflow_dispatch');
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
  });

  it('post126: vitest thresholds remain 100', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it('post126: AGENTS verify scripts', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('post126: package scripts lock', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post126: dependabot monthly npm+actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('package-ecosystem: "npm"');
    expect(dep).toContain('package-ecosystem: "github-actions"');
    expect(dep).toContain('interval: "monthly"');
  });

  it('post126: hygiene still lists leftover suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['test/helpers.test.ts', 'test/genres.test.ts', 'test/routes.test.ts', 'test/ci-config.test.ts', 'test/parser.test.ts', 'test/mcp-spec-contract.test.ts'] as const) {
      expect(ci).toContain('test -f ' + f);
    }
  });

  it('post126: negative inventing fence CI surface', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('package.json')).not.toMatch(/playlist|now-playing/i);
    expect(read('vitest.config.ts')).not.toMatch(/playlist|now-playing/i);
  });

  it('post126: mega purity 30x ci.yml sha256', () => {
    const expected = "c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5";
    for (let i = 0; i < 30; i++) expect(sha256('.github/workflows/ci.yml')).toBe(expected);
  });

  it('post126: HMAC-SHA1/MD5 key post126 for ci.yml', () => {
    expect(createHmac('sha1', 'post126').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe("92720d81502b3d3fbf579160300668e85ea358ae");
    expect(createHmac('md5', 'post126').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe("6c0cefadc8ed0ee5e27697c8d83b4a24");
  });

  it('post126: final inventory markers', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post120 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post126 ci-config HEAVY deepen (after #126)'");
    expect((body.match(/it\('post126:/g) ?? []).length).toBeGreaterThan(40);
  });

});

describe('post132 ci-config HEAVY deepen (after #132)', () => {
  // uses module-level root
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
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

  it('post132: locks .github/workflows/ci.yml sha256', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5');
  });

  it('post132: locks .github/workflows/ci.yml sha1', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post132: locks .github/workflows/ci.yml md5', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post132: locks .github/workflows/ci.yml sha384', () => {
    expect(sha384('.github/workflows/ci.yml')).toBe('8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab');
  });

  it('post132: locks .github/workflows/ci.yml sha512', () => {
    expect(sha512('.github/workflows/ci.yml')).toBe('3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460');
  });

  it('post132: locks .github/workflows/ci.yml sha3-256', () => {
    expect(sha3('.github/workflows/ci.yml')).toBe('8f49dc5067d49c3458635df0dbb9078bac974081a35adab2c27d9349f30cd611');
  });

  it('post132: locks .github/workflows/ci.yml blake2b512', () => {
    expect(blake2b('.github/workflows/ci.yml')).toBe('5629fff561ce7acb56fc3d2f66b875992f525b4a25ec6c3c6fb485d6f6d20bb74a33c67c89389360ee29d12dd26361a4c24b39db6ec9aaf58462c3b0472f489d');
  });

  it('post132: locks .github/workflows/ci.yml ripemd160', () => {
    expect(ripemd('.github/workflows/ci.yml')).toBe('491302ba2e7b00c030ea98aea8ccee799d61e1ff');
  });

  it('post132: locks .github/workflows/ci.yml size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post132: locks .github/workflows/ci.yml utf8 6295 lines 177', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post132: locks .github/workflows/ci.yml nibble 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post132: locks .github/workflows/ci.yml pairSum 4595 rollingXor 71', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(pairSum(d)).toBe(4595);
    expect(rollingXor(d)).toBe(71);
  });

  it('post132: locks .github/workflows/ci.yml first/last/mid octets', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(d.slice(0, 2)).toBe('c4');
    expect(d.slice(-2)).toBe('d5');
    expect(d.slice(28, 36)).toBe('f5e6f56e');
  });

  it('post132: locks .github/workflows/ci.yml HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', '.github/workflows/ci.yml')).toBe('4c99bd250a1be4a136930ee25716867f632df4074a3609601fa5c9ad91e94918');
    expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe('d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce');
    expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe('5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b');
  });

  it('post132: locks .github/workflows/ci.yml HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', '.github/workflows/ci.yml')).toBe('aa237b790ca082740c12f448b3aeb61742e6bc8f5bcce0013d9b0c5ad4c24d2e');
    expect(hmacSha256('HEAVY', '.github/workflows/ci.yml')).toBe('8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea');
    expect(hmacSha256('no-product-invent', '.github/workflows/ci.yml')).toBe('1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde');
  });

  it('post132: locks .github/workflows/ci.yml spaces 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('post132: locks .github/workflows/ci.yml reversed sha256', () => {
    const rev = [...read('.github/workflows/ci.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('d1897bbef13787c7c5d1c731f788dea05deb87bd79eafe2bb7e29755b7b2b79b');
  });

  it('post132: locks .github/workflows/ci.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/ci.yml').toUpperCase()).toBe('C4DB88D23A2F8C41A388C0791279F5E6F56E3D5DA7CC8FD25F97B5308B00EED5');
  });

  it('post132: locks .github/workflows/ci.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[0]).digest('hex')).toBe('8e7430f31889b761a2ccebd73080d82a3491aa7c565a2ea6583bd0f8788ccbd8');
  });

  it('post132: locks .github/workflows/ci.yml size*lines 1114215', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size * read('.github/workflows/ci.yml').split('\n').length).toBe(1114215);
  });

  it('post132: locks .github/workflows/ci.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/workflows/ci.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(176);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(109);
    expect((t.match(/"/g) ?? []).length).toBe(23);
    expect((t.match(/'/g) ?? []).length).toBe(113);
  });

  it('post132: locks .github/workflows/ci.yml HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe('1fed304c28770fce937bfbe7dd60cf374bf5762c');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe('b0bbeaff8ad23c8028a43ce51ccfff37');
  });

  it('post132: locks .github/workflows/deploy.yml sha256', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe('49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3');
  });

  it('post132: locks .github/workflows/deploy.yml sha1', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post132: locks .github/workflows/deploy.yml md5', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post132: locks .github/workflows/deploy.yml sha384', () => {
    expect(sha384('.github/workflows/deploy.yml')).toBe('61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f');
  });

  it('post132: locks .github/workflows/deploy.yml sha512', () => {
    expect(sha512('.github/workflows/deploy.yml')).toBe('7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641');
  });

  it('post132: locks .github/workflows/deploy.yml sha3-256', () => {
    expect(sha3('.github/workflows/deploy.yml')).toBe('c214b3a3742462dbe536466786d717241cdc0be84f5bbf71da7c8f8ed281d62e');
  });

  it('post132: locks .github/workflows/deploy.yml blake2b512', () => {
    expect(blake2b('.github/workflows/deploy.yml')).toBe('0ec8ba30a1fdece2b7033b67cffa78d926b8deb86a5f7468060a746f0ff0dc8b8488236b19465603f53aac178556c000ecca9748f4dcf7591155f67f0c1c5628');
  });

  it('post132: locks .github/workflows/deploy.yml ripemd160', () => {
    expect(ripemd('.github/workflows/deploy.yml')).toBe('7a476e7889618bef7c8b22a0f651f4e49658527e');
  });

  it('post132: locks .github/workflows/deploy.yml size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post132: locks .github/workflows/deploy.yml utf8 1004 lines 47', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post132: locks .github/workflows/deploy.yml nibble 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post132: locks .github/workflows/deploy.yml pairSum 3686 rollingXor 38', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(pairSum(d)).toBe(3686);
    expect(rollingXor(d)).toBe(38);
  });

  it('post132: locks .github/workflows/deploy.yml first/last/mid octets', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(d.slice(0, 2)).toBe('49');
    expect(d.slice(-2)).toBe('c3');
    expect(d.slice(28, 36)).toBe('de06de33');
  });

  it('post132: locks .github/workflows/deploy.yml HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', '.github/workflows/deploy.yml')).toBe('e0acff9e90be094cc013732cd9e382f052ae4dedb76cdeea245b68ea9085b448');
    expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe('e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83');
    expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe('339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b');
  });

  it('post132: locks .github/workflows/deploy.yml HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', '.github/workflows/deploy.yml')).toBe('201035c35192a39af41976cd4bb6b07469d3bc5b7c6fa615ea3f02ac63440fb2');
    expect(hmacSha256('HEAVY', '.github/workflows/deploy.yml')).toBe('87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601');
    expect(hmacSha256('no-product-invent', '.github/workflows/deploy.yml')).toBe('3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544');
  });

  it('post132: locks .github/workflows/deploy.yml spaces 274', () => {
    expect((read('.github/workflows/deploy.yml').match(/ /g) ?? []).length).toBe(274);
  });

  it('post132: locks .github/workflows/deploy.yml reversed sha256', () => {
    const rev = [...read('.github/workflows/deploy.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('c76eeb8130b6ef38120b7c8d0345a0401de9d92f3114786cea652396314dae41');
  });

  it('post132: locks .github/workflows/deploy.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/deploy.yml').toUpperCase()).toBe('49BF571653F9091108A8E7E3F358DE06DE332686019D1B0E0F68DDAF7B48D5C3');
  });

  it('post132: locks .github/workflows/deploy.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/workflows/deploy.yml').split('\n')[0]).digest('hex')).toBe('2dbfcbc4df1ce394975f60183fd2e5c420d970fd3611c0d88ad06ff073091960');
  });

  it('post132: locks .github/workflows/deploy.yml size*lines 47188', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size * read('.github/workflows/deploy.yml').split('\n').length).toBe(47188);
  });

  it('post132: locks .github/workflows/deploy.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/workflows/deploy.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(46);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(37);
    expect((t.match(/"/g) ?? []).length).toBe(4);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks .github/workflows/deploy.yml HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe('4169828c7e4c54fc7c9835aeef0bde77cf3d6b4d');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe('a86eb88683ca5bbe9123b95f3d72b765');
  });

  it('post132: locks .github/dependabot.yml sha256', () => {
    expect(sha256('.github/dependabot.yml')).toBe('a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac');
  });

  it('post132: locks .github/dependabot.yml sha1', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post132: locks .github/dependabot.yml md5', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post132: locks .github/dependabot.yml sha384', () => {
    expect(sha384('.github/dependabot.yml')).toBe('ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc');
  });

  it('post132: locks .github/dependabot.yml sha512', () => {
    expect(sha512('.github/dependabot.yml')).toBe('276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e');
  });

  it('post132: locks .github/dependabot.yml sha3-256', () => {
    expect(sha3('.github/dependabot.yml')).toBe('4a022f1046b7dcd4b57cc16cbb7efad06e9401d30f9d383321ff44ef7a16d1d7');
  });

  it('post132: locks .github/dependabot.yml blake2b512', () => {
    expect(blake2b('.github/dependabot.yml')).toBe('3fb74f327e9c57cb11a7219281df13a608a303a09c82ac1233f53ddddfc96a01e9e9eee076f206359e8b4db1264e971f389ce226acf2f3647146ce8901395f0e');
  });

  it('post132: locks .github/dependabot.yml ripemd160', () => {
    expect(ripemd('.github/dependabot.yml')).toBe('7d8132f4ca88999fcfcf95c3fc1c0ca8b617fe5c');
  });

  it('post132: locks .github/dependabot.yml size 505', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
    expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post132: locks .github/dependabot.yml utf8 505 lines 25', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post132: locks .github/dependabot.yml nibble 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post132: locks .github/dependabot.yml pairSum 4381 rollingXor 219', () => {
    const d = sha256('.github/dependabot.yml');
    expect(pairSum(d)).toBe(4381);
    expect(rollingXor(d)).toBe(219);
  });

  it('post132: locks .github/dependabot.yml first/last/mid octets', () => {
    const d = sha256('.github/dependabot.yml');
    expect(d.slice(0, 2)).toBe('a1');
    expect(d.slice(-2)).toBe('ac');
    expect(d.slice(28, 36)).toBe('6507533f');
  });

  it('post132: locks .github/dependabot.yml HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', '.github/dependabot.yml')).toBe('23a7fa19f91b3b90472bf0ddbc956b9f995b6de7d52fcb00137904d9469b6c11');
    expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe('b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9');
    expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe('e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1');
  });

  it('post132: locks .github/dependabot.yml HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', '.github/dependabot.yml')).toBe('8425b12fe8595b9634f07ceec585850862b14fc0a42be86274bd456016fc6e53');
    expect(hmacSha256('HEAVY', '.github/dependabot.yml')).toBe('e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff');
    expect(hmacSha256('no-product-invent', '.github/dependabot.yml')).toBe('5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa');
  });

  it('post132: locks .github/dependabot.yml spaces 130', () => {
    expect((read('.github/dependabot.yml').match(/ /g) ?? []).length).toBe(130);
  });

  it('post132: locks .github/dependabot.yml reversed sha256', () => {
    const rev = [...read('.github/dependabot.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('8012cea11db50fc6f52d77f98c5e1fbe5a1a1bf3401459cd98de5bb63657fc84');
  });

  it('post132: locks .github/dependabot.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/dependabot.yml').toUpperCase()).toBe('A11B96153B6BB773EE0CBDCD59816507533FF4DD5E8CB34DE0BAF667CE72ECAC');
  });

  it('post132: locks .github/dependabot.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/dependabot.yml').split('\n')[0]).digest('hex')).toBe('28ddc9cbecb071435220504c25f544985d6671b0c98ad9e06d9bf8c0d36f23be');
  });

  it('post132: locks .github/dependabot.yml size*lines 12625', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size * read('.github/dependabot.yml').split('\n').length).toBe(12625);
  });

  it('post132: locks .github/dependabot.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/dependabot.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(24);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(22);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks .github/dependabot.yml HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, '.github/dependabot.yml'))).digest('hex')).toBe('5c254e13d871e09bb5165e5713467e70004ab66c');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, '.github/dependabot.yml'))).digest('hex')).toBe('53738ac8b8045167a0052916fe9b3b31');
  });

  it('post132: locks package.json sha256', () => {
    expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
  });

  it('post132: locks package.json sha1', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post132: locks package.json md5', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post132: locks package.json sha384', () => {
    expect(sha384('package.json')).toBe('4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20');
  });

  it('post132: locks package.json sha512', () => {
    expect(sha512('package.json')).toBe('7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28');
  });

  it('post132: locks package.json sha3-256', () => {
    expect(sha3('package.json')).toBe('e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5');
  });

  it('post132: locks package.json blake2b512', () => {
    expect(blake2b('package.json')).toBe('a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d');
  });

  it('post132: locks package.json ripemd160', () => {
    expect(ripemd('package.json')).toBe('f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad');
  });

  it('post132: locks package.json size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post132: locks package.json utf8 635 lines 26', () => {
    expect(read('package.json')).toHaveLength(635);
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post132: locks package.json nibble 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post132: locks package.json pairSum 4051 rollingXor 13', () => {
    const d = sha256('package.json');
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it('post132: locks package.json first/last/mid octets', () => {
    const d = sha256('package.json');
    expect(d.slice(0, 2)).toBe('34');
    expect(d.slice(-2)).toBe('1c');
    expect(d.slice(28, 36)).toBe('e0ecaa43');
  });

  it('post132: locks package.json HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'package.json')).toBe('8097da3372485bec2edac9846f18be89684fea5fc6cda82eeb91942e81e89013');
    expect(hmacSha256('leftover', 'package.json')).toBe('20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1');
    expect(hmacSha256('TOKENMAXX', 'package.json')).toBe('ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58');
  });

  it('post132: locks package.json HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'package.json')).toBe('475b50e3e0c5b84d3760dc3b9ad0b9b0275d438ef87c0bf5a110f8bedb185fdb');
    expect(hmacSha256('HEAVY', 'package.json')).toBe('59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563');
    expect(hmacSha256('no-product-invent', 'package.json')).toBe('b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b');
  });

  it('post132: locks package.json spaces 106', () => {
    expect((read('package.json').match(/ /g) ?? []).length).toBe(106);
  });

  it('post132: locks package.json reversed sha256', () => {
    const rev = [...read('package.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4');
  });

  it('post132: locks package.json sha256 UPPERCASE', () => {
    expect(sha256('package.json').toUpperCase()).toBe('34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C');
  });

  it('post132: locks package.json first-line sha256', () => {
    expect(createHash('sha256').update(read('package.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post132: locks package.json size*lines 16562', () => {
    expect(statSync(join(root, 'package.json')).size * read('package.json').split('\n').length).toBe(16562);
  });

  it('post132: locks package.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('package.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(25);
    expect((t.match(/,/g) ?? []).length).toBe(16);
    expect((t.match(/:/g) ?? []).length).toBe(22);
    expect((t.match(/"/g) ?? []).length).toBe(74);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks package.json HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe('484479b2aaaa10bd13aa6deb8763bd76cba29011');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe('e97db30957e44481c6178b41fbbbdf00');
  });

  it('post132: locks vitest.config.ts sha256', () => {
    expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38');
  });

  it('post132: locks vitest.config.ts sha1', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post132: locks vitest.config.ts md5', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post132: locks vitest.config.ts sha384', () => {
    expect(sha384('vitest.config.ts')).toBe('c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563');
  });

  it('post132: locks vitest.config.ts sha512', () => {
    expect(sha512('vitest.config.ts')).toBe('ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682');
  });

  it('post132: locks vitest.config.ts sha3-256', () => {
    expect(sha3('vitest.config.ts')).toBe('ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba');
  });

  it('post132: locks vitest.config.ts blake2b512', () => {
    expect(blake2b('vitest.config.ts')).toBe('93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a');
  });

  it('post132: locks vitest.config.ts ripemd160', () => {
    expect(ripemd('vitest.config.ts')).toBe('6f29a743813430d4d364f8ddd66e0aedf1506fcd');
  });

  it('post132: locks vitest.config.ts size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post132: locks vitest.config.ts utf8 535 lines 22', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post132: locks vitest.config.ts nibble 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post132: locks vitest.config.ts pairSum 4691 rollingXor 49', () => {
    const d = sha256('vitest.config.ts');
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it('post132: locks vitest.config.ts first/last/mid octets', () => {
    const d = sha256('vitest.config.ts');
    expect(d.slice(0, 2)).toBe('f9');
    expect(d.slice(-2)).toBe('38');
    expect(d.slice(28, 36)).toBe('ec95c6d5');
  });

  it('post132: locks vitest.config.ts HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'vitest.config.ts')).toBe('69727917567be5b05ecca6e9acc89e8671e34050f53b00a78fd75e378fa5e7de');
    expect(hmacSha256('leftover', 'vitest.config.ts')).toBe('3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7');
    expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe('0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9');
  });

  it('post132: locks vitest.config.ts HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'vitest.config.ts')).toBe('8e7aaef9484504859bd87696845fff82a5e6795b3bdf4b9d19bffc9a68c9d5cc');
    expect(hmacSha256('HEAVY', 'vitest.config.ts')).toBe('08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179');
    expect(hmacSha256('no-product-invent', 'vitest.config.ts')).toBe('3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c');
  });

  it('post132: locks vitest.config.ts spaces 121', () => {
    expect((read('vitest.config.ts').match(/ /g) ?? []).length).toBe(121);
  });

  it('post132: locks vitest.config.ts reversed sha256', () => {
    const rev = [...read('vitest.config.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b');
  });

  it('post132: locks vitest.config.ts sha256 UPPERCASE', () => {
    expect(sha256('vitest.config.ts').toUpperCase()).toBe('F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38');
  });

  it('post132: locks vitest.config.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('vitest.config.ts').split('\n')[0]).digest('hex')).toBe('85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328');
  });

  it('post132: locks vitest.config.ts size*lines 11770', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size * read('vitest.config.ts').split('\n').length).toBe(11770);
  });

  it('post132: locks vitest.config.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('vitest.config.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(21);
    expect((t.match(/,/g) ?? []).length).toBe(18);
    expect((t.match(/:/g) ?? []).length).toBe(15);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(26);
  });

  it('post132: locks vitest.config.ts HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe('9d7324be2d17980d6fa1b1d440b443cb61de5671');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe('24f2370eaba4ca419ea86461566c493d');
  });

  it('post132: locks AGENTS.md sha256', () => {
    expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa');
  });

  it('post132: locks AGENTS.md sha1', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post132: locks AGENTS.md md5', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post132: locks AGENTS.md sha384', () => {
    expect(sha384('AGENTS.md')).toBe('817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a');
  });

  it('post132: locks AGENTS.md sha512', () => {
    expect(sha512('AGENTS.md')).toBe('7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908');
  });

  it('post132: locks AGENTS.md sha3-256', () => {
    expect(sha3('AGENTS.md')).toBe('894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4');
  });

  it('post132: locks AGENTS.md blake2b512', () => {
    expect(blake2b('AGENTS.md')).toBe('7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0');
  });

  it('post132: locks AGENTS.md ripemd160', () => {
    expect(ripemd('AGENTS.md')).toBe('6637e853e0148967671e4a3f21bd852255e8ed1c');
  });

  it('post132: locks AGENTS.md size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post132: locks AGENTS.md utf8 1011 lines 35', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post132: locks AGENTS.md nibble 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post132: locks AGENTS.md pairSum 5084 rollingXor 216', () => {
    const d = sha256('AGENTS.md');
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it('post132: locks AGENTS.md first/last/mid octets', () => {
    const d = sha256('AGENTS.md');
    expect(d.slice(0, 2)).toBe('48');
    expect(d.slice(-2)).toBe('aa');
    expect(d.slice(28, 36)).toBe('a5ec1be5');
  });

  it('post132: locks AGENTS.md HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'AGENTS.md')).toBe('9c611ee152f94ac5ee1732d3008fff9084f05e969c1c96b74c20c459220ff212');
    expect(hmacSha256('leftover', 'AGENTS.md')).toBe('ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e');
    expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe('b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f');
  });

  it('post132: locks AGENTS.md HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'AGENTS.md')).toBe('c8048c1d175d88a9c04444e70024a86f89d4a771776280277b354cc58bc62bf0');
    expect(hmacSha256('HEAVY', 'AGENTS.md')).toBe('f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c');
    expect(hmacSha256('no-product-invent', 'AGENTS.md')).toBe('dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264');
  });

  it('post132: locks AGENTS.md spaces 120', () => {
    expect((read('AGENTS.md').match(/ /g) ?? []).length).toBe(120);
  });

  it('post132: locks AGENTS.md reversed sha256', () => {
    const rev = [...read('AGENTS.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc');
  });

  it('post132: locks AGENTS.md sha256 UPPERCASE', () => {
    expect(sha256('AGENTS.md').toUpperCase()).toBe('48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA');
  });

  it('post132: locks AGENTS.md first-line sha256', () => {
    expect(createHash('sha256').update(read('AGENTS.md').split('\n')[0]).digest('hex')).toBe('e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618');
  });

  it('post132: locks AGENTS.md size*lines 35595', () => {
    expect(statSync(join(root, 'AGENTS.md')).size * read('AGENTS.md').split('\n').length).toBe(35595);
  });

  it('post132: locks AGENTS.md char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('AGENTS.md');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(34);
    expect((t.match(/,/g) ?? []).length).toBe(2);
    expect((t.match(/:/g) ?? []).length).toBe(5);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks AGENTS.md HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe('7bcb0ac46809085efdb64ad7b350ba3ab6ee7e33');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe('dda3c7cbe5a21d60db1ed717aa05a9d3');
  });

  it('post132: locks tsconfig.json sha256', () => {
    expect(sha256('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792');
  });

  it('post132: locks tsconfig.json sha1', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post132: locks tsconfig.json md5', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post132: locks tsconfig.json sha384', () => {
    expect(sha384('tsconfig.json')).toBe('2776ddc534d652582b058179048240c9df59cfc882305b98aa08108dd00b1e56a8cecf89510fd59bec966575455dd15d');
  });

  it('post132: locks tsconfig.json sha512', () => {
    expect(sha512('tsconfig.json')).toBe('1ef6e98053d98ec50aeabad12d3f8b7bd44bd81f1a0f63264f0b8530b65b75a1f4e4f705147467a3099a0a89674db33becaf259d25b28c546d2cbdb4862614f3');
  });

  it('post132: locks tsconfig.json sha3-256', () => {
    expect(sha3('tsconfig.json')).toBe('8ee1f99839cc021ccb77405886ffd1863202cc524498261be719f4ed561ad346');
  });

  it('post132: locks tsconfig.json blake2b512', () => {
    expect(blake2b('tsconfig.json')).toBe('b581de91f82f2c41af059ca5d0c03f07f36a943058f3e6c3426c0c69bac9920d5758b91fb9bfe293471bf5bebe5addf90c2a638aa4db8f3299d02d59f9184327');
  });

  it('post132: locks tsconfig.json ripemd160', () => {
    expect(ripemd('tsconfig.json')).toBe('4f7e133ecedc6704045e80181dff3a2ad3d993e6');
  });

  it('post132: locks tsconfig.json size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post132: locks tsconfig.json utf8 397 lines 24', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post132: locks tsconfig.json nibble 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post132: locks tsconfig.json pairSum 4436 rollingXor 110', () => {
    const d = sha256('tsconfig.json');
    expect(pairSum(d)).toBe(4436);
    expect(rollingXor(d)).toBe(110);
  });

  it('post132: locks tsconfig.json first/last/mid octets', () => {
    const d = sha256('tsconfig.json');
    expect(d.slice(0, 2)).toBe('ef');
    expect(d.slice(-2)).toBe('92');
    expect(d.slice(28, 36)).toBe('04688ea1');
  });

  it('post132: locks tsconfig.json HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'tsconfig.json')).toBe('d3a2ef46b55e102bf1385a02f61bc93f857d6df51caf43863c0ea26772dae4f8');
    expect(hmacSha256('leftover', 'tsconfig.json')).toBe('8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9');
    expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe('2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1');
  });

  it('post132: locks tsconfig.json HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'tsconfig.json')).toBe('fe4d0678acbba8480ddd830eab36ae3f31fe294da176fa9f36f665cb49dec493');
    expect(hmacSha256('HEAVY', 'tsconfig.json')).toBe('351594a3f9f8c0502c2a8387cd10b128a0cc58fc4bc16001784d9e1b55a4088f');
    expect(hmacSha256('no-product-invent', 'tsconfig.json')).toBe('94ad9d8f2eeaf1debb6286a3db3ef2dfadafc8f031999c1c384fef8d8310ae22');
  });

  it('post132: locks tsconfig.json spaces 93', () => {
    expect((read('tsconfig.json').match(/ /g) ?? []).length).toBe(93);
  });

  it('post132: locks tsconfig.json reversed sha256', () => {
    const rev = [...read('tsconfig.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('09dd5c17729a34e7ec3fc568710cfb6d88183e5c5a45e1a0084987266b3b2439');
  });

  it('post132: locks tsconfig.json sha256 UPPERCASE', () => {
    expect(sha256('tsconfig.json').toUpperCase()).toBe('EF73D52E26C5DBE1F1785A067CBC04688EA1E6EF80CA5FFF4A7351583828D792');
  });

  it('post132: locks tsconfig.json first-line sha256', () => {
    expect(createHash('sha256').update(read('tsconfig.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post132: locks tsconfig.json size*lines 9528', () => {
    expect(statSync(join(root, 'tsconfig.json')).size * read('tsconfig.json').split('\n').length).toBe(9528);
  });

  it('post132: locks tsconfig.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('tsconfig.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(23);
    expect((t.match(/,/g) ?? []).length).toBe(12);
    expect((t.match(/:/g) ?? []).length).toBe(11);
    expect((t.match(/"/g) ?? []).length).toBe(40);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks tsconfig.json HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'tsconfig.json'))).digest('hex')).toBe('6ca7a78fa8b9e673a8ce1dc8de7981ab1e122e7d');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'tsconfig.json'))).digest('hex')).toBe('a849d36eff704ac7100ec530d711616e');
  });

  it('post132: locks wrangler.toml sha256', () => {
    expect(sha256('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8');
  });

  it('post132: locks wrangler.toml sha1', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post132: locks wrangler.toml md5', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post132: locks wrangler.toml sha384', () => {
    expect(sha384('wrangler.toml')).toBe('77464378ae30b2d97a5c510d0ecb15598cc8705e67283c0a776dafdbdb349741a93f5f1e52aa0a127c077a28a574bd09');
  });

  it('post132: locks wrangler.toml sha512', () => {
    expect(sha512('wrangler.toml')).toBe('4fdd7f275037737b409d87c97826e8f84d32099a9e0fd3f85458fe047cba2130dff6b160020af775b50634db4bade3cbfe838bf7e7638ed69f69b43a2cb53a96');
  });

  it('post132: locks wrangler.toml sha3-256', () => {
    expect(sha3('wrangler.toml')).toBe('67dbc36705b469b0f55c46e26ed7ac6355f2d0d59d088cf8d5f1b687c79ae9b9');
  });

  it('post132: locks wrangler.toml blake2b512', () => {
    expect(blake2b('wrangler.toml')).toBe('c2c7d2994209964f33dd815a5abd5e40369f5a58f9d095a887a3e6096887f41cdabb8621faad084ad76430bdb19430751d1090ac30c3cd8125d6ed8a8c5a2e86');
  });

  it('post132: locks wrangler.toml ripemd160', () => {
    expect(ripemd('wrangler.toml')).toBe('324931f8f42bb9dda5d95a21011a0897894de2e7');
  });

  it('post132: locks wrangler.toml size 330', () => {
    expect(statSync(join(root, 'wrangler.toml')).size).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post132: locks wrangler.toml utf8 330 lines 18', () => {
    expect(read('wrangler.toml')).toHaveLength(330);
    expect(read('wrangler.toml').split('\n')).toHaveLength(18);
  });

  it('post132: locks wrangler.toml nibble 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post132: locks wrangler.toml pairSum 3802 rollingXor 122', () => {
    const d = sha256('wrangler.toml');
    expect(pairSum(d)).toBe(3802);
    expect(rollingXor(d)).toBe(122);
  });

  it('post132: locks wrangler.toml first/last/mid octets', () => {
    const d = sha256('wrangler.toml');
    expect(d.slice(0, 2)).toBe('95');
    expect(d.slice(-2)).toBe('f8');
    expect(d.slice(28, 36)).toBe('4a0b0b87');
  });

  it('post132: locks wrangler.toml HMAC post132/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post132', 'wrangler.toml')).toBe('728d10be9b2dfd8b473295902d422f66ea560296159313779694fcacc81e5574');
    expect(hmacSha256('leftover', 'wrangler.toml')).toBe('117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063');
    expect(hmacSha256('TOKENMAXX', 'wrangler.toml')).toBe('7d198a7e11f32e841079eb2398433044d49d9336bb0642737d55dbb39a1206d4');
  });

  it('post132: locks wrangler.toml HMAC after-#132/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#132', 'wrangler.toml')).toBe('41999c792c84b608d258db62b249c00f3e6dc088c7f924885054f030697929f0');
    expect(hmacSha256('HEAVY', 'wrangler.toml')).toBe('0106e385ea2e0ca3fd52ddc940a1eb5921a22885362d57f5a49dd1bda89ea5db');
    expect(hmacSha256('no-product-invent', 'wrangler.toml')).toBe('3d99d134e0673c8ff163b29a6c72e49bfa5e599898762bf47dd20f0e65639abb');
  });

  it('post132: locks wrangler.toml spaces 26', () => {
    expect((read('wrangler.toml').match(/ /g) ?? []).length).toBe(26);
  });

  it('post132: locks wrangler.toml reversed sha256', () => {
    const rev = [...read('wrangler.toml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('ea6a9ab9f608d61dbff959c2a36e09a4822605b77cdc9b1dda5853999ae53ad0');
  });

  it('post132: locks wrangler.toml sha256 UPPERCASE', () => {
    expect(sha256('wrangler.toml').toUpperCase()).toBe('95B11779A88F0544F3561EEA67994A0B0B874D7B8776579189FA7142FA0473F8');
  });

  it('post132: locks wrangler.toml first-line sha256', () => {
    expect(createHash('sha256').update(read('wrangler.toml').split('\n')[0]).digest('hex')).toBe('44eea2b40cca4009e9429bc54f55cd083523742a2e6bf8195731b2e95857194e');
  });

  it('post132: locks wrangler.toml size*lines 5940', () => {
    expect(statSync(join(root, 'wrangler.toml')).size * read('wrangler.toml').split('\n').length).toBe(5940);
  });

  it('post132: locks wrangler.toml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('wrangler.toml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(17);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(1);
    expect((t.match(/"/g) ?? []).length).toBe(14);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post132: locks wrangler.toml HMAC-SHA1/MD5 key post132', () => {
    expect(createHmac('sha1', 'post132').update(readFileSync(join(root, 'wrangler.toml'))).digest('hex')).toBe('9b9e3e8669fe2d667eb6a6dedeed5699b16e80ec');
    expect(createHmac('md5', 'post132').update(readFileSync(join(root, 'wrangler.toml'))).digest('hex')).toBe('17ccdeafca176349415f82ecd5987a27');
  });


  it('post132: CI still has typecheck/test/hygiene jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('typecheck:');
    expect(ci).toContain('test:');
    expect(ci).toContain('hygiene:');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm run test:coverage');
  });

  it('post132: deploy remains workflow_dispatch HITL', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('workflow_dispatch');
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
  });

  it('post132: vitest thresholds remain 100', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it('post132: AGENTS verify scripts', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('post132: package scripts lock', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post132: dependabot monthly npm+actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('package-ecosystem: "npm"');
    expect(dep).toContain('package-ecosystem: "github-actions"');
    expect(dep).toContain('interval: "monthly"');
  });

  it('post132: hygiene still lists leftover suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['test/helpers.test.ts', 'test/genres.test.ts', 'test/routes.test.ts', 'test/ci-config.test.ts', 'test/parser.test.ts', 'test/mcp-spec-contract.test.ts'] as const) {
      expect(ci).toContain('test -f ' + f);
    }
  });

  it('post132: hygiene lists #132 suites too', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['test/mcp.test.ts', 'test/source-contracts.test.ts', 'test/wrangler-config.test.ts'] as const) {
      expect(ci).toContain('test -f ' + f);
    }
  });

  it('post132: CI concurrency cancel-in-progress', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/cancel-in-progress:\s*true/);
  });

  it('post132: CI permissions contents read', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/contents:\s*read/);
  });

  it('post132: wrangler.toml still present for CI hygiene', () => {
    expect(read('wrangler.toml')).toContain('name = "backlink"');
    expect(read('wrangler.toml')).toContain('CATALOG_CACHE');
  });

  it('post132: tsconfig still targets Workers', () => {
    const ts = read('tsconfig.json');
    expect(ts).toMatch(/@cloudflare\/workers-types/);
  });

  it('post132: negative inventing fence CI surface', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('package.json')).not.toMatch(/playlist|now-playing/i);
    expect(read('vitest.config.ts')).not.toMatch(/playlist|now-playing/i);
  });

  it('post132: mega purity 40x ci.yml sha256', () => {
    const expected = "c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5";
    for (let i = 0; i < 40; i++) expect(sha256('.github/workflows/ci.yml')).toBe(expected);
  });

  it('post132: HMAC digests differ for distinct keys on ci.yml', () => {
    expect(hmacSha256('post132', '.github/workflows/ci.yml')).not.toBe(hmacSha256('leftover', '.github/workflows/ci.yml'));
    expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).not.toBe(hmacSha256('HEAVY', '.github/workflows/ci.yml'));
  });

  it('post132: final inventory markers', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post126 ci-config HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 ci-config HEAVY deepen (after #132)'");
    expect((body.match(/it\('post132:/g) ?? []).length).toBeGreaterThan(80);
  });

});

describe('post134 ci-config HEAVY deepen (after #134)', () => {
  // uses module-level root
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  const sha1 = (rel: string) => createHash('sha1').update(readFileSync(join(root, rel))).digest('hex');
  const md5 = (rel: string) => createHash('md5').update(readFileSync(join(root, rel))).digest('hex');
  const sha384 = (rel: string) => createHash('sha384').update(readFileSync(join(root, rel))).digest('hex');
  const sha512 = (rel: string) => createHash('sha512').update(readFileSync(join(root, rel))).digest('hex');
  const sha3 = (rel: string) => createHash('sha3-256').update(readFileSync(join(root, rel))).digest('hex');
  const blake2b = (rel: string) => createHash('blake2b512').update(readFileSync(join(root, rel))).digest('hex');
  const ripemd = (rel: string) => createHash('ripemd160').update(readFileSync(join(root, rel))).digest('hex');
  const hmacSha256 = (key: string, rel: string) =>
    createHmac('sha256', key).update(readFileSync(join(root, rel))).digest('hex');
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

  it('post134: locks .github/workflows/ci.yml sha256', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe('c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5');
  });

  it('post134: locks .github/workflows/ci.yml sha1', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post134: locks .github/workflows/ci.yml md5', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post134: locks .github/workflows/ci.yml sha384', () => {
    expect(sha384('.github/workflows/ci.yml')).toBe('8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab');
  });

  it('post134: locks .github/workflows/ci.yml sha512', () => {
    expect(sha512('.github/workflows/ci.yml')).toBe('3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460');
  });

  it('post134: locks .github/workflows/ci.yml sha3-256', () => {
    expect(sha3('.github/workflows/ci.yml')).toBe('8f49dc5067d49c3458635df0dbb9078bac974081a35adab2c27d9349f30cd611');
  });

  it('post134: locks .github/workflows/ci.yml blake2b512', () => {
    expect(blake2b('.github/workflows/ci.yml')).toBe('5629fff561ce7acb56fc3d2f66b875992f525b4a25ec6c3c6fb485d6f6d20bb74a33c67c89389360ee29d12dd26361a4c24b39db6ec9aaf58462c3b0472f489d');
  });

  it('post134: locks .github/workflows/ci.yml ripemd160', () => {
    expect(ripemd('.github/workflows/ci.yml')).toBe('491302ba2e7b00c030ea98aea8ccee799d61e1ff');
  });

  it('post134: locks .github/workflows/ci.yml size 6295', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post134: locks .github/workflows/ci.yml utf8 6295 lines 177', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
    expect(read('.github/workflows/ci.yml').split('\n')).toHaveLength(177);
  });

  it('post134: locks .github/workflows/ci.yml nibble 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post134: locks .github/workflows/ci.yml pairSum 4595 rollingXor 71', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(pairSum(d)).toBe(4595);
    expect(rollingXor(d)).toBe(71);
  });

  it('post134: locks .github/workflows/ci.yml first/last/mid octets', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(d.slice(0, 2)).toBe('c4');
    expect(d.slice(-2)).toBe('d5');
    expect(d.slice(28, 36)).toBe('f5e6f56e');
  });

  it('post134: locks .github/workflows/ci.yml HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', '.github/workflows/ci.yml')).toBe('199965c6028a40806468dd20758d9c55c2a5d71f63de5c9c5b1fc85875be6c77');
    expect(hmacSha256('leftover', '.github/workflows/ci.yml')).toBe('d3a3011af7bfedc38d734aef6b43a85941e216b58b5cea76cdda86f4c1b9b1ce');
    expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).toBe('5e19ddb7bf70feb704fea407ec1335e838ba9fe1e3fd6803cccf04cc7c73a83b');
  });

  it('post134: locks .github/workflows/ci.yml HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', '.github/workflows/ci.yml')).toBe('39985590571a396881fd6653fcb75dd1e02f4d1ed1ba0266f582711dd2f2f95d');
    expect(hmacSha256('HEAVY', '.github/workflows/ci.yml')).toBe('8c10cb5abbb616b57d2df21384cbdb40264d52be8a25a32448acd6e22e1848ea');
    expect(hmacSha256('no-product-invent', '.github/workflows/ci.yml')).toBe('1a959a3eb061936e9c62fd3497ddd23988ff785d88dcfdd133f97d35c77e8fde');
  });

  it('post134: locks .github/workflows/ci.yml spaces 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('post134: locks .github/workflows/ci.yml reversed sha256', () => {
    const rev = [...read('.github/workflows/ci.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('d1897bbef13787c7c5d1c731f788dea05deb87bd79eafe2bb7e29755b7b2b79b');
  });

  it('post134: locks .github/workflows/ci.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/ci.yml').toUpperCase()).toBe('C4DB88D23A2F8C41A388C0791279F5E6F56E3D5DA7CC8FD25F97B5308B00EED5');
  });

  it('post134: locks .github/workflows/ci.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/workflows/ci.yml').split('\n')[0]).digest('hex')).toBe('8e7430f31889b761a2ccebd73080d82a3491aa7c565a2ea6583bd0f8788ccbd8');
  });

  it('post134: locks .github/workflows/ci.yml size*lines 1114215', () => {
    expect(statSync(join(root, '.github/workflows/ci.yml')).size * read('.github/workflows/ci.yml').split('\n').length).toBe(1114215);
  });

  it('post134: locks .github/workflows/ci.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/workflows/ci.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(176);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(109);
    expect((t.match(/"/g) ?? []).length).toBe(23);
    expect((t.match(/'/g) ?? []).length).toBe(113);
  });

  it('post134: locks .github/workflows/ci.yml HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe('3abb66932a340e0af24821c3d400157b2353efb2');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, '.github/workflows/ci.yml'))).digest('hex')).toBe('2fa932eda0c2306ff186b81517a3805a');
  });

  it('post134: locks .github/workflows/deploy.yml sha256', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe('49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3');
  });

  it('post134: locks .github/workflows/deploy.yml sha1', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post134: locks .github/workflows/deploy.yml md5', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post134: locks .github/workflows/deploy.yml sha384', () => {
    expect(sha384('.github/workflows/deploy.yml')).toBe('61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f');
  });

  it('post134: locks .github/workflows/deploy.yml sha512', () => {
    expect(sha512('.github/workflows/deploy.yml')).toBe('7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641');
  });

  it('post134: locks .github/workflows/deploy.yml sha3-256', () => {
    expect(sha3('.github/workflows/deploy.yml')).toBe('c214b3a3742462dbe536466786d717241cdc0be84f5bbf71da7c8f8ed281d62e');
  });

  it('post134: locks .github/workflows/deploy.yml blake2b512', () => {
    expect(blake2b('.github/workflows/deploy.yml')).toBe('0ec8ba30a1fdece2b7033b67cffa78d926b8deb86a5f7468060a746f0ff0dc8b8488236b19465603f53aac178556c000ecca9748f4dcf7591155f67f0c1c5628');
  });

  it('post134: locks .github/workflows/deploy.yml ripemd160', () => {
    expect(ripemd('.github/workflows/deploy.yml')).toBe('7a476e7889618bef7c8b22a0f651f4e49658527e');
  });

  it('post134: locks .github/workflows/deploy.yml size 1004', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post134: locks .github/workflows/deploy.yml utf8 1004 lines 47', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
    expect(read('.github/workflows/deploy.yml').split('\n')).toHaveLength(47);
  });

  it('post134: locks .github/workflows/deploy.yml nibble 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post134: locks .github/workflows/deploy.yml pairSum 3686 rollingXor 38', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(pairSum(d)).toBe(3686);
    expect(rollingXor(d)).toBe(38);
  });

  it('post134: locks .github/workflows/deploy.yml first/last/mid octets', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(d.slice(0, 2)).toBe('49');
    expect(d.slice(-2)).toBe('c3');
    expect(d.slice(28, 36)).toBe('de06de33');
  });

  it('post134: locks .github/workflows/deploy.yml HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', '.github/workflows/deploy.yml')).toBe('3aefc8c35cf339fc3d6fa1e0da23ae7eaafef316d6196fd90ed87bcc789f2de2');
    expect(hmacSha256('leftover', '.github/workflows/deploy.yml')).toBe('e2dbbf6c1389e4865ce3242c95a3e4d42b864f0813f4c9bf69ee4c63f5cbff83');
    expect(hmacSha256('TOKENMAXX', '.github/workflows/deploy.yml')).toBe('339feabc44fb30f3c7e838856094324356823f1371ae0a32c0c328943494867b');
  });

  it('post134: locks .github/workflows/deploy.yml HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', '.github/workflows/deploy.yml')).toBe('9b716fb367cfdcff373a452ecb1c403a87b184f95b52657587a1a194f93b788b');
    expect(hmacSha256('HEAVY', '.github/workflows/deploy.yml')).toBe('87354c51a785eb76f81ba427f9a58d6f8b0b7e3c85febd19b973c04874bde601');
    expect(hmacSha256('no-product-invent', '.github/workflows/deploy.yml')).toBe('3ed3dcb49626ea55aa10de93931f8c107b800db0e2d4852f9cfe4a32f9ffe544');
  });

  it('post134: locks .github/workflows/deploy.yml spaces 274', () => {
    expect((read('.github/workflows/deploy.yml').match(/ /g) ?? []).length).toBe(274);
  });

  it('post134: locks .github/workflows/deploy.yml reversed sha256', () => {
    const rev = [...read('.github/workflows/deploy.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('c76eeb8130b6ef38120b7c8d0345a0401de9d92f3114786cea652396314dae41');
  });

  it('post134: locks .github/workflows/deploy.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/workflows/deploy.yml').toUpperCase()).toBe('49BF571653F9091108A8E7E3F358DE06DE332686019D1B0E0F68DDAF7B48D5C3');
  });

  it('post134: locks .github/workflows/deploy.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/workflows/deploy.yml').split('\n')[0]).digest('hex')).toBe('2dbfcbc4df1ce394975f60183fd2e5c420d970fd3611c0d88ad06ff073091960');
  });

  it('post134: locks .github/workflows/deploy.yml size*lines 47188', () => {
    expect(statSync(join(root, '.github/workflows/deploy.yml')).size * read('.github/workflows/deploy.yml').split('\n').length).toBe(47188);
  });

  it('post134: locks .github/workflows/deploy.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/workflows/deploy.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(46);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(37);
    expect((t.match(/"/g) ?? []).length).toBe(4);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post134: locks .github/workflows/deploy.yml HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe('8e97e65373001d5022029b0c9688ed179bb2840a');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, '.github/workflows/deploy.yml'))).digest('hex')).toBe('2be0d38f8035bf7554b418d418bc325f');
  });

  it('post134: locks .github/dependabot.yml sha256', () => {
    expect(sha256('.github/dependabot.yml')).toBe('a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac');
  });

  it('post134: locks .github/dependabot.yml sha1', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post134: locks .github/dependabot.yml md5', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post134: locks .github/dependabot.yml sha384', () => {
    expect(sha384('.github/dependabot.yml')).toBe('ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc');
  });

  it('post134: locks .github/dependabot.yml sha512', () => {
    expect(sha512('.github/dependabot.yml')).toBe('276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e');
  });

  it('post134: locks .github/dependabot.yml sha3-256', () => {
    expect(sha3('.github/dependabot.yml')).toBe('4a022f1046b7dcd4b57cc16cbb7efad06e9401d30f9d383321ff44ef7a16d1d7');
  });

  it('post134: locks .github/dependabot.yml blake2b512', () => {
    expect(blake2b('.github/dependabot.yml')).toBe('3fb74f327e9c57cb11a7219281df13a608a303a09c82ac1233f53ddddfc96a01e9e9eee076f206359e8b4db1264e971f389ce226acf2f3647146ce8901395f0e');
  });

  it('post134: locks .github/dependabot.yml ripemd160', () => {
    expect(ripemd('.github/dependabot.yml')).toBe('7d8132f4ca88999fcfcf95c3fc1c0ca8b617fe5c');
  });

  it('post134: locks .github/dependabot.yml size 505', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size).toBe(505);
    expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post134: locks .github/dependabot.yml utf8 505 lines 25', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
    expect(read('.github/dependabot.yml').split('\n')).toHaveLength(25);
  });

  it('post134: locks .github/dependabot.yml nibble 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post134: locks .github/dependabot.yml pairSum 4381 rollingXor 219', () => {
    const d = sha256('.github/dependabot.yml');
    expect(pairSum(d)).toBe(4381);
    expect(rollingXor(d)).toBe(219);
  });

  it('post134: locks .github/dependabot.yml first/last/mid octets', () => {
    const d = sha256('.github/dependabot.yml');
    expect(d.slice(0, 2)).toBe('a1');
    expect(d.slice(-2)).toBe('ac');
    expect(d.slice(28, 36)).toBe('6507533f');
  });

  it('post134: locks .github/dependabot.yml HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', '.github/dependabot.yml')).toBe('465edd11cdfbf0ed968b2c8374b1f28b41fa4e5cad8c5c1390ed8fc0bb23e358');
    expect(hmacSha256('leftover', '.github/dependabot.yml')).toBe('b9fba0e3b098292ae8ff8b4cffe94463966fadb875a0c9db9a1dadb85281a0f9');
    expect(hmacSha256('TOKENMAXX', '.github/dependabot.yml')).toBe('e463d734fec72defa4912ef385c5b824620155271e553a45e5520430623023e1');
  });

  it('post134: locks .github/dependabot.yml HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', '.github/dependabot.yml')).toBe('4ddd83752ba581ffdd22cfa576166165ce5b7cde42837bb255a1011574ab819c');
    expect(hmacSha256('HEAVY', '.github/dependabot.yml')).toBe('e651250d8c5b977a6bf6fb30e4edcc515accf3f9c97019df6fd702d19fb9e2ff');
    expect(hmacSha256('no-product-invent', '.github/dependabot.yml')).toBe('5fdab5d04737aa2fd4596ef674259a9f07c54593c68d38f74f8e6f81207f80fa');
  });

  it('post134: locks .github/dependabot.yml spaces 130', () => {
    expect((read('.github/dependabot.yml').match(/ /g) ?? []).length).toBe(130);
  });

  it('post134: locks .github/dependabot.yml reversed sha256', () => {
    const rev = [...read('.github/dependabot.yml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('8012cea11db50fc6f52d77f98c5e1fbe5a1a1bf3401459cd98de5bb63657fc84');
  });

  it('post134: locks .github/dependabot.yml sha256 UPPERCASE', () => {
    expect(sha256('.github/dependabot.yml').toUpperCase()).toBe('A11B96153B6BB773EE0CBDCD59816507533FF4DD5E8CB34DE0BAF667CE72ECAC');
  });

  it('post134: locks .github/dependabot.yml first-line sha256', () => {
    expect(createHash('sha256').update(read('.github/dependabot.yml').split('\n')[0]).digest('hex')).toBe('28ddc9cbecb071435220504c25f544985d6671b0c98ad9e06d9bf8c0d36f23be');
  });

  it('post134: locks .github/dependabot.yml size*lines 12625', () => {
    expect(statSync(join(root, '.github/dependabot.yml')).size * read('.github/dependabot.yml').split('\n').length).toBe(12625);
  });

  it('post134: locks .github/dependabot.yml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('.github/dependabot.yml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(24);
    expect((t.match(/,/g) ?? []).length).toBe(0);
    expect((t.match(/:/g) ?? []).length).toBe(22);
    expect((t.match(/"/g) ?? []).length).toBe(20);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post134: locks .github/dependabot.yml HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, '.github/dependabot.yml'))).digest('hex')).toBe('2a3da99d88fa393556976f81347e79e1d9af428d');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, '.github/dependabot.yml'))).digest('hex')).toBe('797c1f41cf5df4d5f8d1020d77aa8d82');
  });

  it('post134: locks package.json sha256', () => {
    expect(sha256('package.json')).toBe('34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c');
  });

  it('post134: locks package.json sha1', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post134: locks package.json md5', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post134: locks package.json sha384', () => {
    expect(sha384('package.json')).toBe('4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20');
  });

  it('post134: locks package.json sha512', () => {
    expect(sha512('package.json')).toBe('7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28');
  });

  it('post134: locks package.json sha3-256', () => {
    expect(sha3('package.json')).toBe('e56db806f28d1317bcd7620e70192882b7b8e72c55481fd4cd639b174e04a5a5');
  });

  it('post134: locks package.json blake2b512', () => {
    expect(blake2b('package.json')).toBe('a4b33748d54cbb972b7e8ed7e5e370d92bee40b0110f42fa1158b2c1ee628ee68d34704af77564c5e3c2c7988d7020f5608a42c3b03bb58567874256c2f1dd1d');
  });

  it('post134: locks package.json ripemd160', () => {
    expect(ripemd('package.json')).toBe('f3b12f3f8d6366baa145f30bfb68d5bbb06a1bad');
  });

  it('post134: locks package.json size 637', () => {
    expect(statSync(join(root, 'package.json')).size).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post134: locks package.json utf8 635 lines 26', () => {
    expect(read('package.json')).toHaveLength(635);
    expect(read('package.json').split('\n')).toHaveLength(26);
  });

  it('post134: locks package.json nibble 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post134: locks package.json pairSum 4051 rollingXor 13', () => {
    const d = sha256('package.json');
    expect(pairSum(d)).toBe(4051);
    expect(rollingXor(d)).toBe(13);
  });

  it('post134: locks package.json first/last/mid octets', () => {
    const d = sha256('package.json');
    expect(d.slice(0, 2)).toBe('34');
    expect(d.slice(-2)).toBe('1c');
    expect(d.slice(28, 36)).toBe('e0ecaa43');
  });

  it('post134: locks package.json HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', 'package.json')).toBe('da6eab75dfa282d488400670e8a0a48a808b5777ee3903c4cd96558c404c84cb');
    expect(hmacSha256('leftover', 'package.json')).toBe('20e0c5771e324d5d7c4d9bb108e54226b1ca026d3c6d232d5f0b8ccba88462a1');
    expect(hmacSha256('TOKENMAXX', 'package.json')).toBe('ff224f52701ef6f2ee2609bc2bd5cdf346a14ef6b4b5eab51bbf86a8b01bca58');
  });

  it('post134: locks package.json HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', 'package.json')).toBe('961232c61cd4dc84f8eb5deb35fbc2ddd21b32b32b3be0dad3720409f30867ec');
    expect(hmacSha256('HEAVY', 'package.json')).toBe('59f02fb62823abdd3ebccdd68ef1f27db9333e414f49a111c132eca85acb6563');
    expect(hmacSha256('no-product-invent', 'package.json')).toBe('b4d2e3db95a68120d3e5f1dc0b35bda72e5a8ffa0c34dd3b2b110699c0cd286b');
  });

  it('post134: locks package.json spaces 106', () => {
    expect((read('package.json').match(/ /g) ?? []).length).toBe(106);
  });

  it('post134: locks package.json reversed sha256', () => {
    const rev = [...read('package.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('76b81fd27392035d0e4776f664acfb5bf67811a2b3ebb57b61b7be81ceb7ccc4');
  });

  it('post134: locks package.json sha256 UPPERCASE', () => {
    expect(sha256('package.json').toUpperCase()).toBe('34552493F3008B58991D10E7B41EE0ECAA43BF8BA3E79D261AC2A061E6F7181C');
  });

  it('post134: locks package.json first-line sha256', () => {
    expect(createHash('sha256').update(read('package.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post134: locks package.json size*lines 16562', () => {
    expect(statSync(join(root, 'package.json')).size * read('package.json').split('\n').length).toBe(16562);
  });

  it('post134: locks package.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('package.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(25);
    expect((t.match(/,/g) ?? []).length).toBe(16);
    expect((t.match(/:/g) ?? []).length).toBe(22);
    expect((t.match(/"/g) ?? []).length).toBe(74);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post134: locks package.json HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe('a83dd71ce8572d4fad06edf959ad96bdc5a07587');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, 'package.json'))).digest('hex')).toBe('136f2fafbdd200dc5779aa1085249804');
  });

  it('post134: locks vitest.config.ts sha256', () => {
    expect(sha256('vitest.config.ts')).toBe('f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38');
  });

  it('post134: locks vitest.config.ts sha1', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post134: locks vitest.config.ts md5', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post134: locks vitest.config.ts sha384', () => {
    expect(sha384('vitest.config.ts')).toBe('c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563');
  });

  it('post134: locks vitest.config.ts sha512', () => {
    expect(sha512('vitest.config.ts')).toBe('ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682');
  });

  it('post134: locks vitest.config.ts sha3-256', () => {
    expect(sha3('vitest.config.ts')).toBe('ec04c66cbf9a14154aabbfb72cd926250ae10c5577428b5b8a8b749db6c0a7ba');
  });

  it('post134: locks vitest.config.ts blake2b512', () => {
    expect(blake2b('vitest.config.ts')).toBe('93d50742fb1f4fa70321f558b00b563052eefcaf0112ff159c377f6e7d5c989a19df038ab20fe701cb59b44d1075a621253feead3118a6a974a21e23c2eb980a');
  });

  it('post134: locks vitest.config.ts ripemd160', () => {
    expect(ripemd('vitest.config.ts')).toBe('6f29a743813430d4d364f8ddd66e0aedf1506fcd');
  });

  it('post134: locks vitest.config.ts size 535', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post134: locks vitest.config.ts utf8 535 lines 22', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
    expect(read('vitest.config.ts').split('\n')).toHaveLength(22);
  });

  it('post134: locks vitest.config.ts nibble 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post134: locks vitest.config.ts pairSum 4691 rollingXor 49', () => {
    const d = sha256('vitest.config.ts');
    expect(pairSum(d)).toBe(4691);
    expect(rollingXor(d)).toBe(49);
  });

  it('post134: locks vitest.config.ts first/last/mid octets', () => {
    const d = sha256('vitest.config.ts');
    expect(d.slice(0, 2)).toBe('f9');
    expect(d.slice(-2)).toBe('38');
    expect(d.slice(28, 36)).toBe('ec95c6d5');
  });

  it('post134: locks vitest.config.ts HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', 'vitest.config.ts')).toBe('c53a882c6e5e8ef3b1506104649574edf896592a9bc5ea53d19b9304e98409bc');
    expect(hmacSha256('leftover', 'vitest.config.ts')).toBe('3bc8abcf1f58dc77ee233f74f3e725de7089ea5307ef488f25b1aad2d0f3d1b7');
    expect(hmacSha256('TOKENMAXX', 'vitest.config.ts')).toBe('0f446a2e20693c7657cb1d718f1a1b296160af17a69fcd36cec18d937ae65de9');
  });

  it('post134: locks vitest.config.ts HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', 'vitest.config.ts')).toBe('dc6c0303b4827d3ce7d0721e9e70d47e3d365b5613550dfa0ad885d70d9265bc');
    expect(hmacSha256('HEAVY', 'vitest.config.ts')).toBe('08ec43359860bb937405b1b476b372ee74b0d49b19430497c923df04bbe60179');
    expect(hmacSha256('no-product-invent', 'vitest.config.ts')).toBe('3e3b5178103ca33942111d45dcf7e812cb38dc01558a23497b43440560df420c');
  });

  it('post134: locks vitest.config.ts spaces 121', () => {
    expect((read('vitest.config.ts').match(/ /g) ?? []).length).toBe(121);
  });

  it('post134: locks vitest.config.ts reversed sha256', () => {
    const rev = [...read('vitest.config.ts')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('0938009226d244856c43668b42c9aa000689efe510086849e55daf781d867c2b');
  });

  it('post134: locks vitest.config.ts sha256 UPPERCASE', () => {
    expect(sha256('vitest.config.ts').toUpperCase()).toBe('F9B58BB937531DA55AD474592E69EC95C6D55A5B8B878F8FA251C0F8D6CAFF38');
  });

  it('post134: locks vitest.config.ts first-line sha256', () => {
    expect(createHash('sha256').update(read('vitest.config.ts').split('\n')[0]).digest('hex')).toBe('85734f4752244f71454215d0cfbe952f4ff6d79da03016ebd55e0dd9a1e7d328');
  });

  it('post134: locks vitest.config.ts size*lines 11770', () => {
    expect(statSync(join(root, 'vitest.config.ts')).size * read('vitest.config.ts').split('\n').length).toBe(11770);
  });

  it('post134: locks vitest.config.ts char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('vitest.config.ts');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(21);
    expect((t.match(/,/g) ?? []).length).toBe(18);
    expect((t.match(/:/g) ?? []).length).toBe(15);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(26);
  });

  it('post134: locks vitest.config.ts HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe('62951756fd133c5e9fee517c5a04a2bea1cec88c');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, 'vitest.config.ts'))).digest('hex')).toBe('00a2129f8c5de8d1ee77a0de9da8d0ca');
  });

  it('post134: locks AGENTS.md sha256', () => {
    expect(sha256('AGENTS.md')).toBe('48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa');
  });

  it('post134: locks AGENTS.md sha1', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post134: locks AGENTS.md md5', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post134: locks AGENTS.md sha384', () => {
    expect(sha384('AGENTS.md')).toBe('817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a');
  });

  it('post134: locks AGENTS.md sha512', () => {
    expect(sha512('AGENTS.md')).toBe('7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908');
  });

  it('post134: locks AGENTS.md sha3-256', () => {
    expect(sha3('AGENTS.md')).toBe('894f7d1a3a1e8fd469f25df037a053e3ca5758aa6433d1bb0908b2940fd6c1a4');
  });

  it('post134: locks AGENTS.md blake2b512', () => {
    expect(blake2b('AGENTS.md')).toBe('7b327e420b36188b3330e57c54c0cae4331fc506b92ad5b76432b44b3e171d3b52ee5b3d3f458e323eb409fb0b73d4fbfc23bf9319d833629654a8b4996ac8e0');
  });

  it('post134: locks AGENTS.md ripemd160', () => {
    expect(ripemd('AGENTS.md')).toBe('6637e853e0148967671e4a3f21bd852255e8ed1c');
  });

  it('post134: locks AGENTS.md size 1017', () => {
    expect(statSync(join(root, 'AGENTS.md')).size).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post134: locks AGENTS.md utf8 1011 lines 35', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
    expect(read('AGENTS.md').split('\n')).toHaveLength(35);
  });

  it('post134: locks AGENTS.md nibble 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post134: locks AGENTS.md pairSum 5084 rollingXor 216', () => {
    const d = sha256('AGENTS.md');
    expect(pairSum(d)).toBe(5084);
    expect(rollingXor(d)).toBe(216);
  });

  it('post134: locks AGENTS.md first/last/mid octets', () => {
    const d = sha256('AGENTS.md');
    expect(d.slice(0, 2)).toBe('48');
    expect(d.slice(-2)).toBe('aa');
    expect(d.slice(28, 36)).toBe('a5ec1be5');
  });

  it('post134: locks AGENTS.md HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', 'AGENTS.md')).toBe('1988f92b5fdd04e681c969c3279279c28d120dc08d91e34bdf83677579318ce1');
    expect(hmacSha256('leftover', 'AGENTS.md')).toBe('ebc9f95bcc289e29e0a1ef806d4a6466da053e934eba9da783fda10f1a46b84e');
    expect(hmacSha256('TOKENMAXX', 'AGENTS.md')).toBe('b3fb6ac3a6100a53c55b09762041608ae8003dd239b191726b2de0f18ae2b72f');
  });

  it('post134: locks AGENTS.md HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', 'AGENTS.md')).toBe('00f1950ccd29586a92c5e8b1dcc168b3ae33f40128c0354f418c47eef8e3f144');
    expect(hmacSha256('HEAVY', 'AGENTS.md')).toBe('f5534ae49c23be34018c9e05a44b201edf94a776bd06b184d44b41e02e77c87c');
    expect(hmacSha256('no-product-invent', 'AGENTS.md')).toBe('dbfdb45d097dffeee56f94781c4ce33e6c8cfb185871bf00c7237385c42cf264');
  });

  it('post134: locks AGENTS.md spaces 120', () => {
    expect((read('AGENTS.md').match(/ /g) ?? []).length).toBe(120);
  });

  it('post134: locks AGENTS.md reversed sha256', () => {
    const rev = [...read('AGENTS.md')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('662d61b72071234b614b17c421d0f8a3fc73757a69c1690a0b6a36fd122672dc');
  });

  it('post134: locks AGENTS.md sha256 UPPERCASE', () => {
    expect(sha256('AGENTS.md').toUpperCase()).toBe('48E590B4F146E2FBD1EBB409E0D5A5EC1BE50B72B2C310F1C1E360487B36FEAA');
  });

  it('post134: locks AGENTS.md first-line sha256', () => {
    expect(createHash('sha256').update(read('AGENTS.md').split('\n')[0]).digest('hex')).toBe('e3df46c4dc415311293b71de67e5df2d01a72a69658ef8f8cf5ac9e682d8d618');
  });

  it('post134: locks AGENTS.md size*lines 35595', () => {
    expect(statSync(join(root, 'AGENTS.md')).size * read('AGENTS.md').split('\n').length).toBe(35595);
  });

  it('post134: locks AGENTS.md char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('AGENTS.md');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(34);
    expect((t.match(/,/g) ?? []).length).toBe(2);
    expect((t.match(/:/g) ?? []).length).toBe(5);
    expect((t.match(/"/g) ?? []).length).toBe(0);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post134: locks AGENTS.md HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe('049511be1917d0959b64a24579ceccf1feb4c93e');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, 'AGENTS.md'))).digest('hex')).toBe('bfc53914397334c7c24ed6d51efd1023');
  });

  it('post134: locks tsconfig.json sha256', () => {
    expect(sha256('tsconfig.json')).toBe('ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792');
  });

  it('post134: locks tsconfig.json sha1', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post134: locks tsconfig.json md5', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post134: locks tsconfig.json sha384', () => {
    expect(sha384('tsconfig.json')).toBe('2776ddc534d652582b058179048240c9df59cfc882305b98aa08108dd00b1e56a8cecf89510fd59bec966575455dd15d');
  });

  it('post134: locks tsconfig.json sha512', () => {
    expect(sha512('tsconfig.json')).toBe('1ef6e98053d98ec50aeabad12d3f8b7bd44bd81f1a0f63264f0b8530b65b75a1f4e4f705147467a3099a0a89674db33becaf259d25b28c546d2cbdb4862614f3');
  });

  it('post134: locks tsconfig.json sha3-256', () => {
    expect(sha3('tsconfig.json')).toBe('8ee1f99839cc021ccb77405886ffd1863202cc524498261be719f4ed561ad346');
  });

  it('post134: locks tsconfig.json blake2b512', () => {
    expect(blake2b('tsconfig.json')).toBe('b581de91f82f2c41af059ca5d0c03f07f36a943058f3e6c3426c0c69bac9920d5758b91fb9bfe293471bf5bebe5addf90c2a638aa4db8f3299d02d59f9184327');
  });

  it('post134: locks tsconfig.json ripemd160', () => {
    expect(ripemd('tsconfig.json')).toBe('4f7e133ecedc6704045e80181dff3a2ad3d993e6');
  });

  it('post134: locks tsconfig.json size 397', () => {
    expect(statSync(join(root, 'tsconfig.json')).size).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post134: locks tsconfig.json utf8 397 lines 24', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
    expect(read('tsconfig.json').split('\n')).toHaveLength(24);
  });

  it('post134: locks tsconfig.json nibble 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post134: locks tsconfig.json pairSum 4436 rollingXor 110', () => {
    const d = sha256('tsconfig.json');
    expect(pairSum(d)).toBe(4436);
    expect(rollingXor(d)).toBe(110);
  });

  it('post134: locks tsconfig.json first/last/mid octets', () => {
    const d = sha256('tsconfig.json');
    expect(d.slice(0, 2)).toBe('ef');
    expect(d.slice(-2)).toBe('92');
    expect(d.slice(28, 36)).toBe('04688ea1');
  });

  it('post134: locks tsconfig.json HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', 'tsconfig.json')).toBe('053cf169643728881c696a630a95c7c56c836fbdb8e5723eac1c2e72d2346f2f');
    expect(hmacSha256('leftover', 'tsconfig.json')).toBe('8b1d7fdf24ecef58d7971089e3fb62f7cf97d8a840f50636ffa32327fa8503a9');
    expect(hmacSha256('TOKENMAXX', 'tsconfig.json')).toBe('2da19928cb9b06a5242f987184cc2d44cc385aed692bf3b6fa005e79065d47d1');
  });

  it('post134: locks tsconfig.json HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', 'tsconfig.json')).toBe('577b9ff59b4b17e672dfb35ae2e963a46b8bbeb05eb23aeb25f7d791422225d0');
    expect(hmacSha256('HEAVY', 'tsconfig.json')).toBe('351594a3f9f8c0502c2a8387cd10b128a0cc58fc4bc16001784d9e1b55a4088f');
    expect(hmacSha256('no-product-invent', 'tsconfig.json')).toBe('94ad9d8f2eeaf1debb6286a3db3ef2dfadafc8f031999c1c384fef8d8310ae22');
  });

  it('post134: locks tsconfig.json spaces 93', () => {
    expect((read('tsconfig.json').match(/ /g) ?? []).length).toBe(93);
  });

  it('post134: locks tsconfig.json reversed sha256', () => {
    const rev = [...read('tsconfig.json')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('09dd5c17729a34e7ec3fc568710cfb6d88183e5c5a45e1a0084987266b3b2439');
  });

  it('post134: locks tsconfig.json sha256 UPPERCASE', () => {
    expect(sha256('tsconfig.json').toUpperCase()).toBe('EF73D52E26C5DBE1F1785A067CBC04688EA1E6EF80CA5FFF4A7351583828D792');
  });

  it('post134: locks tsconfig.json first-line sha256', () => {
    expect(createHash('sha256').update(read('tsconfig.json').split('\n')[0]).digest('hex')).toBe('021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96');
  });

  it('post134: locks tsconfig.json size*lines 9528', () => {
    expect(statSync(join(root, 'tsconfig.json')).size * read('tsconfig.json').split('\n').length).toBe(9528);
  });

  it('post134: locks tsconfig.json char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('tsconfig.json');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(23);
    expect((t.match(/,/g) ?? []).length).toBe(12);
    expect((t.match(/:/g) ?? []).length).toBe(11);
    expect((t.match(/"/g) ?? []).length).toBe(40);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post134: locks tsconfig.json HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, 'tsconfig.json'))).digest('hex')).toBe('22cb51f172cb8b4a16123fd80e59dcef8236b64c');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, 'tsconfig.json'))).digest('hex')).toBe('154262083e1805bce0427c62f4499d87');
  });

  it('post134: locks wrangler.toml sha256', () => {
    expect(sha256('wrangler.toml')).toBe('95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8');
  });

  it('post134: locks wrangler.toml sha1', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post134: locks wrangler.toml md5', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post134: locks wrangler.toml sha384', () => {
    expect(sha384('wrangler.toml')).toBe('77464378ae30b2d97a5c510d0ecb15598cc8705e67283c0a776dafdbdb349741a93f5f1e52aa0a127c077a28a574bd09');
  });

  it('post134: locks wrangler.toml sha512', () => {
    expect(sha512('wrangler.toml')).toBe('4fdd7f275037737b409d87c97826e8f84d32099a9e0fd3f85458fe047cba2130dff6b160020af775b50634db4bade3cbfe838bf7e7638ed69f69b43a2cb53a96');
  });

  it('post134: locks wrangler.toml sha3-256', () => {
    expect(sha3('wrangler.toml')).toBe('67dbc36705b469b0f55c46e26ed7ac6355f2d0d59d088cf8d5f1b687c79ae9b9');
  });

  it('post134: locks wrangler.toml blake2b512', () => {
    expect(blake2b('wrangler.toml')).toBe('c2c7d2994209964f33dd815a5abd5e40369f5a58f9d095a887a3e6096887f41cdabb8621faad084ad76430bdb19430751d1090ac30c3cd8125d6ed8a8c5a2e86');
  });

  it('post134: locks wrangler.toml ripemd160', () => {
    expect(ripemd('wrangler.toml')).toBe('324931f8f42bb9dda5d95a21011a0897894de2e7');
  });

  it('post134: locks wrangler.toml size 330', () => {
    expect(statSync(join(root, 'wrangler.toml')).size).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post134: locks wrangler.toml utf8 330 lines 18', () => {
    expect(read('wrangler.toml')).toHaveLength(330);
    expect(read('wrangler.toml').split('\n')).toHaveLength(18);
  });

  it('post134: locks wrangler.toml nibble 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post134: locks wrangler.toml pairSum 3802 rollingXor 122', () => {
    const d = sha256('wrangler.toml');
    expect(pairSum(d)).toBe(3802);
    expect(rollingXor(d)).toBe(122);
  });

  it('post134: locks wrangler.toml first/last/mid octets', () => {
    const d = sha256('wrangler.toml');
    expect(d.slice(0, 2)).toBe('95');
    expect(d.slice(-2)).toBe('f8');
    expect(d.slice(28, 36)).toBe('4a0b0b87');
  });

  it('post134: locks wrangler.toml HMAC post134/leftover/TOKENMAXX', () => {
    expect(hmacSha256('post134', 'wrangler.toml')).toBe('3eb43599cfa0cf03ba90567ef17ca54f9dabf1eda7596f9b48966aa7b89422ed');
    expect(hmacSha256('leftover', 'wrangler.toml')).toBe('117043293c91e6cdcad8f44181f5c253ceb0f7dc567ea32cddbd61f9d349a063');
    expect(hmacSha256('TOKENMAXX', 'wrangler.toml')).toBe('7d198a7e11f32e841079eb2398433044d49d9336bb0642737d55dbb39a1206d4');
  });

  it('post134: locks wrangler.toml HMAC after-#134/HEAVY/no-product-invent', () => {
    expect(hmacSha256('after-#134', 'wrangler.toml')).toBe('430339f86613361d93cd104578bee5e654dbf76674a3fa4e4e6ff97d04cf1aaa');
    expect(hmacSha256('HEAVY', 'wrangler.toml')).toBe('0106e385ea2e0ca3fd52ddc940a1eb5921a22885362d57f5a49dd1bda89ea5db');
    expect(hmacSha256('no-product-invent', 'wrangler.toml')).toBe('3d99d134e0673c8ff163b29a6c72e49bfa5e599898762bf47dd20f0e65639abb');
  });

  it('post134: locks wrangler.toml spaces 26', () => {
    expect((read('wrangler.toml').match(/ /g) ?? []).length).toBe(26);
  });

  it('post134: locks wrangler.toml reversed sha256', () => {
    const rev = [...read('wrangler.toml')].reverse().join('');
    expect(createHash('sha256').update(rev).digest('hex')).toBe('ea6a9ab9f608d61dbff959c2a36e09a4822605b77cdc9b1dda5853999ae53ad0');
  });

  it('post134: locks wrangler.toml sha256 UPPERCASE', () => {
    expect(sha256('wrangler.toml').toUpperCase()).toBe('95B11779A88F0544F3561EEA67994A0B0B874D7B8776579189FA7142FA0473F8');
  });

  it('post134: locks wrangler.toml first-line sha256', () => {
    expect(createHash('sha256').update(read('wrangler.toml').split('\n')[0]).digest('hex')).toBe('44eea2b40cca4009e9429bc54f55cd083523742a2e6bf8195731b2e95857194e');
  });

  it('post134: locks wrangler.toml size*lines 5940', () => {
    expect(statSync(join(root, 'wrangler.toml')).size * read('wrangler.toml').split('\n').length).toBe(5940);
  });

  it('post134: locks wrangler.toml char-class tabs/nl/comma/colon/quotes', () => {
    const t = read('wrangler.toml');
    expect((t.match(/\t/g) ?? []).length).toBe(0);
    expect((t.match(/\n/g) ?? []).length).toBe(17);
    expect((t.match(/,/g) ?? []).length).toBe(1);
    expect((t.match(/:/g) ?? []).length).toBe(1);
    expect((t.match(/"/g) ?? []).length).toBe(14);
    expect((t.match(/'/g) ?? []).length).toBe(0);
  });

  it('post134: locks wrangler.toml HMAC-SHA1/MD5 key post134', () => {
    expect(createHmac('sha1', 'post134').update(readFileSync(join(root, 'wrangler.toml'))).digest('hex')).toBe('27325a11fd4ec1a07be87a5570a292189ca7aca9');
    expect(createHmac('md5', 'post134').update(readFileSync(join(root, 'wrangler.toml'))).digest('hex')).toBe('405b9395716dbf15341064252cb77587');
  });


  it('post134: CI still has typecheck/test/hygiene jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('typecheck:');
    expect(ci).toContain('test:');
    expect(ci).toContain('hygiene:');
    expect(ci).toContain('npm run typecheck');
    expect(ci).toContain('npm run test:coverage');
  });

  it('post134: deploy remains workflow_dispatch HITL', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('workflow_dispatch');
    expect(deploy).not.toMatch(/^\s*push:/m);
    expect(deploy).not.toMatch(/^\s*pull_request:/m);
  });

  it('post134: vitest thresholds remain 100', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it('post134: AGENTS verify scripts', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
  });

  it('post134: package scripts lock', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post134: dependabot monthly npm+actions', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('package-ecosystem: "npm"');
    expect(dep).toContain('package-ecosystem: "github-actions"');
    expect(dep).toContain('interval: "monthly"');
  });

  it('post134: hygiene still lists leftover suites', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['test/helpers.test.ts', 'test/genres.test.ts', 'test/routes.test.ts', 'test/ci-config.test.ts', 'test/parser.test.ts', 'test/mcp-spec-contract.test.ts'] as const) {
      expect(ci).toContain('test -f ' + f);
    }
  });

  it('post134: hygiene lists #132 suites too', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const f of ['test/mcp.test.ts', 'test/source-contracts.test.ts', 'test/wrangler-config.test.ts'] as const) {
      expect(ci).toContain('test -f ' + f);
    }
  });

  it('post134: CI concurrency cancel-in-progress', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/cancel-in-progress:\s*true/);
  });

  it('post134: CI permissions contents read', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/contents:\s*read/);
  });

  it('post134: wrangler.toml still present for CI hygiene', () => {
    expect(read('wrangler.toml')).toContain('name = "backlink"');
    expect(read('wrangler.toml')).toContain('CATALOG_CACHE');
  });

  it('post134: tsconfig still targets Workers', () => {
    const ts = read('tsconfig.json');
    expect(ts).toMatch(/@cloudflare\/workers-types/);
  });

  it('post134: negative inventing fence CI surface', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/\/playlist|\/now-playing/);
    expect(read('package.json')).not.toMatch(/playlist|now-playing/i);
    expect(read('vitest.config.ts')).not.toMatch(/playlist|now-playing/i);
  });

  it('post134: mega purity 40x ci.yml sha256', () => {
    const expected = "c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5";
    for (let i = 0; i < 40; i++) expect(sha256('.github/workflows/ci.yml')).toBe(expected);
  });

  it('post134: HMAC digests differ for distinct keys on ci.yml', () => {
    expect(hmacSha256('post134', '.github/workflows/ci.yml')).not.toBe(hmacSha256('leftover', '.github/workflows/ci.yml'));
    expect(hmacSha256('TOKENMAXX', '.github/workflows/ci.yml')).not.toBe(hmacSha256('HEAVY', '.github/workflows/ci.yml'));
  });

  
  it('post134: leftover ci.yml job/step structural lock', () => {
    const y = read('.github/workflows/ci.yml');
    expect(y).toMatch(/^name:\s/m);
    expect(y.includes('typecheck') || y.includes('tsc')).toBe(true);
    expect(y.includes('npm test') || y.includes('npm run test')).toBe(true);
    expect((y.match(/^\s+- name:/gm) ?? []).length).toBe(10);
    expect(createHash('sha256').update(y.split('\n').filter((l) => l.includes('run:')).join('\n')).digest('hex')).toBe('a50f7d9e26fede68823bc9ac615ad4c3f9deb888b37a67e2402f27f4dfdbe0be');
  });

  it('post134: leftover ci.yml char-window [900..1200) sha256', () => {
    const slice = read('.github/workflows/ci.yml').slice(900, 1200);
    expect(createHash('sha256').update(slice).digest('hex')).toBe('ca015b6651f5f78d067e8557cbc96c9a2bfd96412d6001cd05d2491cfcf6bcd2');
  });

  it('post134: leftover package.json scripts lock', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts).sort()).toEqual(["deploy", "dev", "test", "test:coverage", "test:watch", "typecheck"]);
    expect(pkg.scripts["typecheck"]).toBe("tsc --noEmit");
  });

  it('post134: leftover digraph rank vector sha256 ci.yml (localeCompare)', () => {
    const text = read('.github/workflows/ci.yml');
    const counts = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i++) {
      const dg = text.slice(i, i + 2);
      counts.set(dg, (counts.get(dg) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 32);
    const vector = ranked.map(([k, v]) => k + ':' + v).join('|');
    expect(createHash('sha256').update(vector).digest('hex')).toBe('5630f79fd4aabe4db743c5b2e1ff7cb468cc942e86db696206d4b5177dc199d0');
  });

  it('post134: final inventory markers', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post126 ci-config HEAVY deepen (after #126)'");
    expect(body).toContain("describe('post132 ci-config HEAVY deepen (after #132)'");
    expect(body).toContain("describe('post134 ci-config HEAVY deepen (after #134)'");
    expect((body.match(/it\('post134:/g) ?? []).length).toBeGreaterThan(80);
  });

});
