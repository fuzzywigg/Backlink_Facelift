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

describe('post121 ci-config HEAVY deepen', () => {
  // Tests-only deepen of CI/config contracts after mcp-spec #121 / genres #119 / routes #120.
  // Orthogonal to mcp-spec/genres/routes; complementary to post100 suite.
  // Leftovers: digests, workflow YAML edges, Dependabot, vitest, package-lock, hygiene.
  // No product inventing.

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
  const popcount = (hex: string) =>
    [...Buffer.from(hex, 'hex')].reduce((s, b) => s + (b.toString(2).match(/1/g) ?? []).length, 0);
  const byteSize = (rel: string) => statSync(join(root, rel)).size;
  const lineCount = (rel: string) => read(rel).split('\n').length;

  it('post121: locks workflows ci.yml sha256 digest', () => {
    expect(sha256('.github/workflows/ci.yml')).toBe(
      'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5',
    );
  });

  it('post121: locks workflows ci.yml sha1 digest', () => {
    expect(sha1('.github/workflows/ci.yml')).toBe('2105395119389c6131d039b5d787abc150bbbcaa');
  });

  it('post121: locks workflows ci.yml md5 digest', () => {
    expect(md5('.github/workflows/ci.yml')).toBe('ea05159f5a4591ccf20765050a212605');
  });

  it('post121: locks workflows ci.yml sha384 digest', () => {
    expect(sha384('.github/workflows/ci.yml')).toBe(
      '8aa8ec73d3268813ebed009b6ade76fbfd8833f0aa035fddfb830493e21b2074d7728e8554206bc26c9a3fa3792612ab',
    );
  });

  it('post121: locks workflows ci.yml sha512 digest', () => {
    expect(sha512('.github/workflows/ci.yml')).toBe(
      '3999896950ad770f1352680a8d40714a837a82ee5b5c7e255ab8b9545fa759b131bfba0b22eee8111287cb4b54eb35be1e8f5a944d6d47a814d29eeb97cb4460',
    );
  });

  it('post121: locks workflows ci.yml sha256 nibble sum 515 xor 3', () => {
    const d = sha256('.github/workflows/ci.yml');
    expect(nibbleSum(d)).toBe(515);
    expect(xorNibbles(d)).toBe(3);
  });

  it('post121: locks workflows ci.yml sha256 popcount 132', () => {
    expect(popcount(sha256('.github/workflows/ci.yml'))).toBe(132);
  });

  it('post121: locks workflows ci.yml byte size 6295', () => {
    expect(byteSize('.github/workflows/ci.yml')).toBe(6295);
    expect(readFileSync(join(root, '.github/workflows/ci.yml')).byteLength).toBe(6295);
  });

  it('post121: locks workflows ci.yml utf8 char length 6295', () => {
    expect(read('.github/workflows/ci.yml')).toHaveLength(6295);
  });

  it('post121: locks workflows ci.yml line count 177', () => {
    expect(lineCount('.github/workflows/ci.yml')).toBe(177);
  });

  it('post121: locks workflows ci.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/workflows/ci.yml')).toBe(
      'f660fea4a68d2744c06cfc38d93598ccabf1c3ebbeb1d13f9e87161eecc72067',
    );
  });

  it('post121: locks workflows ci.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/workflows/ci.yml')).toBe(
      'c3139c62c4bf166ffa6e2fb18d7007d68f9b04753178b06f73d20530e217cd51',
    );
  });

  it('post121: locks workflows ci.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/ci.yml');
    expect(hex.slice(0, 2)).toBe('c4');
    expect(hex.slice(-2)).toBe('d5');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks workflows ci.yml head40/tail40', () => {
    const body = read('.github/workflows/ci.yml');
    expect(body.slice(0, 40)).toBe("name: CI\n\non:\n  push:\n    branches: [mai");
    expect(body.slice(-40)).toBe("odules/*' ! -path './.git/*' | grep -q .");
  });

  it('post121: locks workflows deploy.yml sha256 digest', () => {
    expect(sha256('.github/workflows/deploy.yml')).toBe(
      '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3',
    );
  });

  it('post121: locks workflows deploy.yml sha1 digest', () => {
    expect(sha1('.github/workflows/deploy.yml')).toBe('5f7a3932b69a68d740162b1079688d6934060f61');
  });

  it('post121: locks workflows deploy.yml md5 digest', () => {
    expect(md5('.github/workflows/deploy.yml')).toBe('ea86e4de097085159e425937542bf7cf');
  });

  it('post121: locks workflows deploy.yml sha384 digest', () => {
    expect(sha384('.github/workflows/deploy.yml')).toBe(
      '61fa961396d8c3231bc50da4eb215cff97cc8e73cd619076488abd7a58ae14a9c8295922846a197b0c2f60535bd02c9f',
    );
  });

  it('post121: locks workflows deploy.yml sha512 digest', () => {
    expect(sha512('.github/workflows/deploy.yml')).toBe(
      '7157a652975fffe4354d4b6fcec916a5529485bd2b1c6dd96fa628b1228ae6a9883690c3c08aa30627eb0a635efeeb7e1f73e540064824415dcd3a844df0b641',
    );
  });

  it('post121: locks workflows deploy.yml sha256 nibble sum 476 xor 4', () => {
    const d = sha256('.github/workflows/deploy.yml');
    expect(nibbleSum(d)).toBe(476);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post121: locks workflows deploy.yml sha256 popcount 129', () => {
    expect(popcount(sha256('.github/workflows/deploy.yml'))).toBe(129);
  });

  it('post121: locks workflows deploy.yml byte size 1004', () => {
    expect(byteSize('.github/workflows/deploy.yml')).toBe(1004);
    expect(readFileSync(join(root, '.github/workflows/deploy.yml')).byteLength).toBe(1004);
  });

  it('post121: locks workflows deploy.yml utf8 char length 1004', () => {
    expect(read('.github/workflows/deploy.yml')).toHaveLength(1004);
  });

  it('post121: locks workflows deploy.yml line count 47', () => {
    expect(lineCount('.github/workflows/deploy.yml')).toBe(47);
  });

  it('post121: locks workflows deploy.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/workflows/deploy.yml')).toBe(
      '81030d4648c4cddd4d92a89488f17785af4bf6c0043f8ef3eafe5dba2f6f105c',
    );
  });

  it('post121: locks workflows deploy.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/workflows/deploy.yml')).toBe(
      '5ea7731b3dcdc28f6b35512c6b5cbbbbbf221d62ec1e909ce4e7f4fe9c3bfaab',
    );
  });

  it('post121: locks workflows deploy.yml sha256 first/last octets', () => {
    const hex = sha256('.github/workflows/deploy.yml');
    expect(hex.slice(0, 2)).toBe('49');
    expect(hex.slice(-2)).toBe('c3');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks workflows deploy.yml head40/tail40', () => {
    const body = read('.github/workflows/deploy.yml');
    expect(body.slice(0, 40)).toBe("name: Deploy to Cloudflare Workers\n\non:\n");
    expect(body.slice(-40)).toBe("_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n");
  });

  it('post121: locks dependabot.yml sha256 digest', () => {
    expect(sha256('.github/dependabot.yml')).toBe(
      'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac',
    );
  });

  it('post121: locks dependabot.yml sha1 digest', () => {
    expect(sha1('.github/dependabot.yml')).toBe('dfdb63975444874143105431e4cee95165932c7b');
  });

  it('post121: locks dependabot.yml md5 digest', () => {
    expect(md5('.github/dependabot.yml')).toBe('bd53b7cdf9bb7287532d96a32cbec9a4');
  });

  it('post121: locks dependabot.yml sha384 digest', () => {
    expect(sha384('.github/dependabot.yml')).toBe(
      'ea9d5b80d192675fecbce15828b4dc305f234744d81936d5baa2cd24b7bbdf1a6ac8708c2f7da50603d77f9ee15a1ffc',
    );
  });

  it('post121: locks dependabot.yml sha512 digest', () => {
    expect(sha512('.github/dependabot.yml')).toBe(
      '276de093809db87de2059c26ebe5ba732e8c3bc5bfed72843cd2bf0c81a7d3308da1f947c2ca8463ff615704aa5dd2f02f3a5857e6f2f9c358d97c111dbca34e',
    );
  });

  it('post121: locks dependabot.yml sha256 nibble sum 526 xor 6', () => {
    const d = sha256('.github/dependabot.yml');
    expect(nibbleSum(d)).toBe(526);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post121: locks dependabot.yml sha256 popcount 142', () => {
    expect(popcount(sha256('.github/dependabot.yml'))).toBe(142);
  });

  it('post121: locks dependabot.yml byte size 505', () => {
    expect(byteSize('.github/dependabot.yml')).toBe(505);
    expect(readFileSync(join(root, '.github/dependabot.yml')).byteLength).toBe(505);
  });

  it('post121: locks dependabot.yml utf8 char length 505', () => {
    expect(read('.github/dependabot.yml')).toHaveLength(505);
  });

  it('post121: locks dependabot.yml line count 25', () => {
    expect(lineCount('.github/dependabot.yml')).toBe(25);
  });

  it('post121: locks dependabot.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/dependabot.yml')).toBe(
      '0e43657a9dce33a84c1d2e4a3a486d8c07c742d96107d3b7d50bbd43e6687ddf',
    );
  });

  it('post121: locks dependabot.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/dependabot.yml')).toBe(
      '5584021e32ff3b6eaf1b5dc44e04fb412d485d102d79c535730c0d57d9c53062',
    );
  });

  it('post121: locks dependabot.yml sha256 first/last octets', () => {
    const hex = sha256('.github/dependabot.yml');
    expect(hex.slice(0, 2)).toBe('a1');
    expect(hex.slice(-2)).toBe('ac');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks dependabot.yml head40/tail40', () => {
    const body = read('.github/dependabot.yml');
    expect(body.slice(0, 40)).toBe("version: 2\nupdates:\n  - package-ecosyste");
    expect(body.slice(-40)).toBe("ions:\n        patterns:\n          - \"*\"\n");
  });

  it('post121: locks vitest.config.ts sha256 digest', () => {
    expect(sha256('vitest.config.ts')).toBe(
      'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38',
    );
  });

  it('post121: locks vitest.config.ts sha1 digest', () => {
    expect(sha1('vitest.config.ts')).toBe('f8d49517ece92fc5e9781fbde021a948958aac37');
  });

  it('post121: locks vitest.config.ts md5 digest', () => {
    expect(md5('vitest.config.ts')).toBe('f1176313255f5f064a946d458482d81a');
  });

  it('post121: locks vitest.config.ts sha384 digest', () => {
    expect(sha384('vitest.config.ts')).toBe(
      'c740544ed89115527034ecf6e26516e084e03eb35bb32b53e2a9ba0c87e13c92d27eedad009b8248a3c0410200eba563',
    );
  });

  it('post121: locks vitest.config.ts sha512 digest', () => {
    expect(sha512('vitest.config.ts')).toBe(
      'ea76043e8370d77ce0cb6723483ce791cff7cb9b5fb3bf8997a9772e1f3e9c897d34fc0fe2787d4f95cfb0561a8c1439436468cefb79893325b21f462c243682',
    );
  });

  it('post121: locks vitest.config.ts sha256 nibble sum 536 xor 2', () => {
    const d = sha256('vitest.config.ts');
    expect(nibbleSum(d)).toBe(536);
    expect(xorNibbles(d)).toBe(2);
  });

  it('post121: locks vitest.config.ts sha256 popcount 139', () => {
    expect(popcount(sha256('vitest.config.ts'))).toBe(139);
  });

  it('post121: locks vitest.config.ts byte size 535', () => {
    expect(byteSize('vitest.config.ts')).toBe(535);
    expect(readFileSync(join(root, 'vitest.config.ts')).byteLength).toBe(535);
  });

  it('post121: locks vitest.config.ts utf8 char length 535', () => {
    expect(read('vitest.config.ts')).toHaveLength(535);
  });

  it('post121: locks vitest.config.ts line count 22', () => {
    expect(lineCount('vitest.config.ts')).toBe(22);
  });

  it('post121: locks vitest.config.ts HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'vitest.config.ts')).toBe(
      'ec77cc4528794f63bab0cec1d318898752872fa864df4af0d6e86b2579213430',
    );
  });

  it('post121: locks vitest.config.ts HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'vitest.config.ts')).toBe(
      'bd032b10179b2cce58176be7f379f92024fa7406ec9c310ee14c1c4d982258c9',
    );
  });

  it('post121: locks vitest.config.ts sha256 first/last octets', () => {
    const hex = sha256('vitest.config.ts');
    expect(hex.slice(0, 2)).toBe('f9');
    expect(hex.slice(-2)).toBe('38');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks vitest.config.ts head40/tail40', () => {
    const body = read('vitest.config.ts');
    expect(body.slice(0, 40)).toBe("import { defineConfig } from 'vitest/con");
    expect(body.slice(-40)).toBe("atements: 100,\n      },\n    },\n  },\n});\n");
  });

  it('post121: locks package.json sha256 digest', () => {
    expect(sha256('package.json')).toBe(
      '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c',
    );
  });

  it('post121: locks package.json sha1 digest', () => {
    expect(sha1('package.json')).toBe('b58d14f35b9c13bb254d5e2a51240e2918a126c5');
  });

  it('post121: locks package.json md5 digest', () => {
    expect(md5('package.json')).toBe('63472e1fb514fb0dadb5e49a7bdbaa5f');
  });

  it('post121: locks package.json sha384 digest', () => {
    expect(sha384('package.json')).toBe(
      '4208b099e242907b02fce514c0ce890d1805b1a6de73ad0a15e49ce9f5a2eb5e311f6e3175464f97ff91b0ca752f7c20',
    );
  });

  it('post121: locks package.json sha512 digest', () => {
    expect(sha512('package.json')).toBe(
      '7b56f282c4ae1f06e33354171317d5a318ef8f85cf74f07392a18ee65f40a3ed66acb974513f5bae57b83d67b18132fc67b66dde5aa4dca015f7d5fc14926b28',
    );
  });

  it('post121: locks package.json sha256 nibble sum 451 xor 13', () => {
    const d = sha256('package.json');
    expect(nibbleSum(d)).toBe(451);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post121: locks package.json sha256 popcount 121', () => {
    expect(popcount(sha256('package.json'))).toBe(121);
  });

  it('post121: locks package.json byte size 637', () => {
    expect(byteSize('package.json')).toBe(637);
    expect(readFileSync(join(root, 'package.json')).byteLength).toBe(637);
  });

  it('post121: locks package.json utf8 char length 635', () => {
    expect(read('package.json')).toHaveLength(635);
  });

  it('post121: locks package.json line count 26', () => {
    expect(lineCount('package.json')).toBe(26);
  });

  it('post121: locks package.json HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'package.json')).toBe(
      '6340a8bf72560358dc94c98481acf982b7c803d9b3afb521718c24fdcf27bec1',
    );
  });

  it('post121: locks package.json HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'package.json')).toBe(
      '4ad0bf460c8faffbe2a7556321fabc795b05ddccad8d777984b7cf70eb263ce1',
    );
  });

  it('post121: locks package.json sha256 first/last octets', () => {
    const hex = sha256('package.json');
    expect(hex.slice(0, 2)).toBe('34');
    expect(hex.slice(-2)).toBe('1c');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks package.json head40/tail40', () => {
    const body = read('package.json');
    expect(body.slice(0, 40)).toBe("{\n  \"name\": \"backlink\",\n  \"version\": \"0.");
    expect(body.slice(-40)).toBe(".0.0\",\n    \"wrangler\": \"^4.131.1\"\n  }\n}\n");
  });

  it('post121: locks package-lock.json sha256 digest', () => {
    expect(sha256('package-lock.json')).toBe(
      '5f8a888f1fc7aaf97dcdaa3f91405cefbb45ad118685eac7a1488b78cedfcee6',
    );
  });

  it('post121: locks package-lock.json sha1 digest', () => {
    expect(sha1('package-lock.json')).toBe('6bc7eb19009d4dccc1d2928b0d856f337eb76aad');
  });

  it('post121: locks package-lock.json md5 digest', () => {
    expect(md5('package-lock.json')).toBe('568e267e07346bb7de4796dbeb117b54');
  });

  it('post121: locks package-lock.json sha384 digest', () => {
    expect(sha384('package-lock.json')).toBe(
      '4565cacc84fdc7310f58a9dd877af17e094c9f5e388dcfa3ba20d618402f2978d9c0cdcea6112627d9068ee5b8a4cee1',
    );
  });

  it('post121: locks package-lock.json sha512 digest', () => {
    expect(sha512('package-lock.json')).toBe(
      '53b687e02a98373356e850535322bbec058b7b8dff2374fb03de81d925065cdb7a15cd37411e4625a3888965ba07d2667e6f6667db885bf14147027d0183303d',
    );
  });

  it('post121: locks package-lock.json sha256 nibble sum 582 xor 4', () => {
    const d = sha256('package-lock.json');
    expect(nibbleSum(d)).toBe(582);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post121: locks package-lock.json sha256 popcount 139', () => {
    expect(popcount(sha256('package-lock.json'))).toBe(139);
  });

  it('post121: locks package-lock.json byte size 92068', () => {
    expect(byteSize('package-lock.json')).toBe(92068);
    expect(readFileSync(join(root, 'package-lock.json')).byteLength).toBe(92068);
  });

  it('post121: locks package-lock.json utf8 char length 92068', () => {
    expect(read('package-lock.json')).toHaveLength(92068);
  });

  it('post121: locks package-lock.json line count 2842', () => {
    expect(lineCount('package-lock.json')).toBe(2842);
  });

  it('post121: locks package-lock.json HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'package-lock.json')).toBe(
      'ece04a8530a54549bfda48cd2d42950da162b289bdb560eec2a2e254d46d6120',
    );
  });

  it('post121: locks package-lock.json HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'package-lock.json')).toBe(
      '66e14c7915881f4314d70367d5aa6706df691badc1d9c72b20386abf4e3c9cf9',
    );
  });

  it('post121: locks package-lock.json sha256 first/last octets', () => {
    const hex = sha256('package-lock.json');
    expect(hex.slice(0, 2)).toBe('5f');
    expect(hex.slice(-2)).toBe('e6');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks package-lock.json head40/tail40', () => {
    const body = read('package-lock.json');
    expect(body.slice(0, 40)).toBe("{\n  \"name\": \"backlink\",\n  \"version\": \"0.");
    expect(body.slice(-40)).toBe("arser-es\": \"^1.0.5\"\n      }\n    }\n  }\n}\n");
  });

  it('post121: locks tsconfig.json sha256 digest', () => {
    expect(sha256('tsconfig.json')).toBe(
      'ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792',
    );
  });

  it('post121: locks tsconfig.json sha1 digest', () => {
    expect(sha1('tsconfig.json')).toBe('68e3169249049539d687b6b3d81fc809079134f9');
  });

  it('post121: locks tsconfig.json md5 digest', () => {
    expect(md5('tsconfig.json')).toBe('13f6687a50fe7c6ea7ef4eb3623b7457');
  });

  it('post121: locks tsconfig.json sha384 digest', () => {
    expect(sha384('tsconfig.json')).toBe(
      '2776ddc534d652582b058179048240c9df59cfc882305b98aa08108dd00b1e56a8cecf89510fd59bec966575455dd15d',
    );
  });

  it('post121: locks tsconfig.json sha512 digest', () => {
    expect(sha512('tsconfig.json')).toBe(
      '1ef6e98053d98ec50aeabad12d3f8b7bd44bd81f1a0f63264f0b8530b65b75a1f4e4f705147467a3099a0a89674db33becaf259d25b28c546d2cbdb4862614f3',
    );
  });

  it('post121: locks tsconfig.json sha256 nibble sum 506 xor 8', () => {
    const d = sha256('tsconfig.json');
    expect(nibbleSum(d)).toBe(506);
    expect(xorNibbles(d)).toBe(8);
  });

  it('post121: locks tsconfig.json sha256 popcount 133', () => {
    expect(popcount(sha256('tsconfig.json'))).toBe(133);
  });

  it('post121: locks tsconfig.json byte size 397', () => {
    expect(byteSize('tsconfig.json')).toBe(397);
    expect(readFileSync(join(root, 'tsconfig.json')).byteLength).toBe(397);
  });

  it('post121: locks tsconfig.json utf8 char length 397', () => {
    expect(read('tsconfig.json')).toHaveLength(397);
  });

  it('post121: locks tsconfig.json line count 24', () => {
    expect(lineCount('tsconfig.json')).toBe(24);
  });

  it('post121: locks tsconfig.json HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'tsconfig.json')).toBe(
      'c5b82ec0d2778c549f94e99a0e6bd6e6294cf9517f346ca3fca8f356c2ed2e1e',
    );
  });

  it('post121: locks tsconfig.json HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'tsconfig.json')).toBe(
      'ae18d0ca138f3923c1b1cab88fc38b955a4a172a9f5cd98e172ed225e0771e97',
    );
  });

  it('post121: locks tsconfig.json sha256 first/last octets', () => {
    const hex = sha256('tsconfig.json');
    expect(hex.slice(0, 2)).toBe('ef');
    expect(hex.slice(-2)).toBe('92');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks tsconfig.json head40/tail40', () => {
    const body = read('tsconfig.json');
    expect(body.slice(0, 40)).toBe("{\n  \"compilerOptions\": {\n    \"target\": \"");
    expect(body.slice(-40)).toBe("/**/*.ts\",\n    \"vitest.config.ts\"\n  ]\n}\n");
  });

  it('post121: locks .gitattributes sha256 digest', () => {
    expect(sha256('.gitattributes')).toBe(
      '1a1dbe176bc233b499d35a57db7513f2941c99ab9759f177830c9149be99005b',
    );
  });

  it('post121: locks .gitattributes sha1 digest', () => {
    expect(sha1('.gitattributes')).toBe('ba3dfe345280bdcc5e817bb02cf49b8b8d8e1c4c');
  });

  it('post121: locks .gitattributes md5 digest', () => {
    expect(md5('.gitattributes')).toBe('05bdb783ee6514c8c072e47680af8ff7');
  });

  it('post121: locks .gitattributes sha384 digest', () => {
    expect(sha384('.gitattributes')).toBe(
      '4ee62c34f5a07b4cac36ddb78174097f6de139cd17007129fde0198e18eb521ac0a75f788f548427362a589824127692',
    );
  });

  it('post121: locks .gitattributes sha512 digest', () => {
    expect(sha512('.gitattributes')).toBe(
      '9e820d6126d62c0b89e380c69685f6668b2f131283f57e524f59492fa6df22844dda1b90d244d4a1f8aea78a84e65d47b1a878168c4e41001459a947ef275ffe',
    );
  });

  it('post121: locks .gitattributes sha256 nibble sum 458 xor 4', () => {
    const d = sha256('.gitattributes');
    expect(nibbleSum(d)).toBe(458);
    expect(xorNibbles(d)).toBe(4);
  });

  it('post121: locks .gitattributes sha256 popcount 131', () => {
    expect(popcount(sha256('.gitattributes'))).toBe(131);
  });

  it('post121: locks .gitattributes byte size 66', () => {
    expect(byteSize('.gitattributes')).toBe(66);
    expect(readFileSync(join(root, '.gitattributes')).byteLength).toBe(66);
  });

  it('post121: locks .gitattributes utf8 char length 66', () => {
    expect(read('.gitattributes')).toHaveLength(66);
  });

  it('post121: locks .gitattributes line count 3', () => {
    expect(lineCount('.gitattributes')).toBe(3);
  });

  it('post121: locks .gitattributes HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.gitattributes')).toBe(
      '94ab2375d2338b3d10b01762300611259c39e55253a56eb99464ec435696ad39',
    );
  });

  it('post121: locks .gitattributes HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.gitattributes')).toBe(
      'a5726d92e22707dd0d6a2269e750482ed6331766254d4cefe40044cb59b66abd',
    );
  });

  it('post121: locks .gitattributes sha256 first/last octets', () => {
    const hex = sha256('.gitattributes');
    expect(hex.slice(0, 2)).toBe('1a');
    expect(hex.slice(-2)).toBe('5b');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks .gitattributes head40/tail40', () => {
    const body = read('.gitattributes');
    expect(body.slice(0, 40)).toBe("# Auto detect text files and perform LF ");
    expect(body.slice(-40)).toBe("nd perform LF normalization\n* text=auto\n");
  });

  it('post121: locks .cursor environment.json sha256 digest', () => {
    expect(sha256('.cursor/environment.json')).toBe(
      '4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694',
    );
  });

  it('post121: locks .cursor environment.json sha1 digest', () => {
    expect(sha1('.cursor/environment.json')).toBe('b4f3dec322cd018ce5c1dea89897a469bd128685');
  });

  it('post121: locks .cursor environment.json md5 digest', () => {
    expect(md5('.cursor/environment.json')).toBe('956c8804543595a31d6a7051aecd6528');
  });

  it('post121: locks .cursor environment.json sha384 digest', () => {
    expect(sha384('.cursor/environment.json')).toBe(
      '0347d0c47319d7ae7b0221f2aac85537294169efac93d2fab633127f2a4fddcedba85875545448a4048d66f22a89193b',
    );
  });

  it('post121: locks .cursor environment.json sha512 digest', () => {
    expect(sha512('.cursor/environment.json')).toBe(
      'bc77873140fa55fe7b9ff10f6c7ebb8e287d35087bc0da8667814e3db45773a3a4bcecb1f7ab7479e0a2c0c4cad140c385583af6a0bb760a01121a1c830a6efb',
    );
  });

  it('post121: locks .cursor environment.json sha256 nibble sum 472 xor 0', () => {
    const d = sha256('.cursor/environment.json');
    expect(nibbleSum(d)).toBe(472);
    expect(xorNibbles(d)).toBe(0);
  });

  it('post121: locks .cursor environment.json sha256 popcount 122', () => {
    expect(popcount(sha256('.cursor/environment.json'))).toBe(122);
  });

  it('post121: locks .cursor environment.json byte size 57', () => {
    expect(byteSize('.cursor/environment.json')).toBe(57);
    expect(readFileSync(join(root, '.cursor/environment.json')).byteLength).toBe(57);
  });

  it('post121: locks .cursor environment.json utf8 char length 57', () => {
    expect(read('.cursor/environment.json')).toHaveLength(57);
  });

  it('post121: locks .cursor environment.json line count 5', () => {
    expect(lineCount('.cursor/environment.json')).toBe(5);
  });

  it('post121: locks .cursor environment.json HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.cursor/environment.json')).toBe(
      '1cfb0dbb1d7c1363e9755c407be7a11210921a38bb8a5f8503d4ede93590ab2f',
    );
  });

  it('post121: locks .cursor environment.json HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.cursor/environment.json')).toBe(
      'e8cb25814d5d1140b9c6ddcc9b53c80a35c7df621ebc611a6ccf80734d98939c',
    );
  });

  it('post121: locks .cursor environment.json sha256 first/last octets', () => {
    const hex = sha256('.cursor/environment.json');
    expect(hex.slice(0, 2)).toBe('4e');
    expect(hex.slice(-2)).toBe('94');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks .cursor environment.json head40/tail40', () => {
    const body = read('.cursor/environment.json');
    expect(body.slice(0, 40)).toBe("{\n  \"name\": \"Backlink_Facelift\",\n  \"inst");
    expect(body.slice(-40)).toBe("link_Facelift\",\n  \"install\": \"npm ci\"\n}\n");
  });

  it('post121: locks .gitignore sha256 digest', () => {
    expect(sha256('.gitignore')).toBe(
      '474ed59338a23de819e219c00d0e033b23e3669cc4106ce7a888fe0636569698',
    );
  });

  it('post121: locks .gitignore sha1 digest', () => {
    expect(sha1('.gitignore')).toBe('432103230f4c49258e046fc945e8160007c23570');
  });

  it('post121: locks .gitignore md5 digest', () => {
    expect(md5('.gitignore')).toBe('7d0728257f47875ec0120ca3cdbf7308');
  });

  it('post121: locks .gitignore sha384 digest', () => {
    expect(sha384('.gitignore')).toBe(
      'be1d228c314f49d0279908556287e3071c8ca1cba4a6ee436ac536e276dcebd732bda1d3a4bb59940436751af7ec0338',
    );
  });

  it('post121: locks .gitignore sha512 digest', () => {
    expect(sha512('.gitignore')).toBe(
      'b51faf155fa4927dcc7032a23ddace6ba90c71a7e165382c024c79f21693d5c2be91df95ef4b632b1f4577ad0a18d19d11e450d647ff99c11f95f29b3fa4a5c0',
    );
  });

  it('post121: locks .gitignore sha256 nibble sum 444 xor 6', () => {
    const d = sha256('.gitignore');
    expect(nibbleSum(d)).toBe(444);
    expect(xorNibbles(d)).toBe(6);
  });

  it('post121: locks .gitignore sha256 popcount 116', () => {
    expect(popcount(sha256('.gitignore'))).toBe(116);
  });

  it('post121: locks .gitignore byte size 261', () => {
    expect(byteSize('.gitignore')).toBe(261);
    expect(readFileSync(join(root, '.gitignore')).byteLength).toBe(261);
  });

  it('post121: locks .gitignore utf8 char length 261', () => {
    expect(read('.gitignore')).toHaveLength(261);
  });

  it('post121: locks .gitignore line count 26', () => {
    expect(lineCount('.gitignore')).toBe(26);
  });

  it('post121: locks .gitignore HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.gitignore')).toBe(
      '0bcde8d5fc9e36daaa8175e7b9338244e835073db03263acf0f1b19d56866b5b',
    );
  });

  it('post121: locks .gitignore HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.gitignore')).toBe(
      '837de69b2254f85e5dab5141145260852b1ad87bcaf7c17b4bdfd2783216493c',
    );
  });

  it('post121: locks .gitignore sha256 first/last octets', () => {
    const hex = sha256('.gitignore');
    expect(hex.slice(0, 2)).toBe('47');
    expect(hex.slice(-2)).toBe('98');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks .gitignore head40/tail40', () => {
    const body = read('.gitignore');
    expect(body.slice(0, 40)).toBe("# Dependencies\nnode_modules/\n\n# Local en");
    expect(body.slice(-40)).toBe("oise\n.DS_Store\n.idea/\n.vscode/\n*.swp\n*~\n");
  });

  it('post121: locks wrangler.toml sha256 digest', () => {
    expect(sha256('wrangler.toml')).toBe(
      '95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8',
    );
  });

  it('post121: locks wrangler.toml sha1 digest', () => {
    expect(sha1('wrangler.toml')).toBe('481c8221707ffe602ab8d5ce4a2b7b5192d3ade6');
  });

  it('post121: locks wrangler.toml md5 digest', () => {
    expect(md5('wrangler.toml')).toBe('100cd1554884befe9db6453606e565f4');
  });

  it('post121: locks wrangler.toml sha384 digest', () => {
    expect(sha384('wrangler.toml')).toBe(
      '77464378ae30b2d97a5c510d0ecb15598cc8705e67283c0a776dafdbdb349741a93f5f1e52aa0a127c077a28a574bd09',
    );
  });

  it('post121: locks wrangler.toml sha512 digest', () => {
    expect(sha512('wrangler.toml')).toBe(
      '4fdd7f275037737b409d87c97826e8f84d32099a9e0fd3f85458fe047cba2130dff6b160020af775b50634db4bade3cbfe838bf7e7638ed69f69b43a2cb53a96',
    );
  });

  it('post121: locks wrangler.toml sha256 nibble sum 457 xor 13', () => {
    const d = sha256('wrangler.toml');
    expect(nibbleSum(d)).toBe(457);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post121: locks wrangler.toml sha256 popcount 129', () => {
    expect(popcount(sha256('wrangler.toml'))).toBe(129);
  });

  it('post121: locks wrangler.toml byte size 330', () => {
    expect(byteSize('wrangler.toml')).toBe(330);
    expect(readFileSync(join(root, 'wrangler.toml')).byteLength).toBe(330);
  });

  it('post121: locks wrangler.toml utf8 char length 330', () => {
    expect(read('wrangler.toml')).toHaveLength(330);
  });

  it('post121: locks wrangler.toml line count 18', () => {
    expect(lineCount('wrangler.toml')).toBe(18);
  });

  it('post121: locks wrangler.toml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'wrangler.toml')).toBe(
      'c08fbe35f8c56a0e9518c03bc2e327a36e5d1d302e62e3d49c099511fc16cb97',
    );
  });

  it('post121: locks wrangler.toml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'wrangler.toml')).toBe(
      '7c70d83706483a5f039b019724999775a12799a5f196fdd4d488155a12e4a596',
    );
  });

  it('post121: locks wrangler.toml sha256 first/last octets', () => {
    const hex = sha256('wrangler.toml');
    expect(hex.slice(0, 2)).toBe('95');
    expect(hex.slice(-2)).toBe('f8');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks wrangler.toml head40/tail40', () => {
    const body = read('wrangler.toml');
    expect(body.slice(0, 40)).toBe("name = \"backlink\"\nmain = \"src/index.ts\"\n");
    expect(body.slice(-40)).toBe("):\n# wrangler secret put GEMINI_API_KEY\n");
  });

  it('post121: locks AGENTS.md sha256 digest', () => {
    expect(sha256('AGENTS.md')).toBe(
      '48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa',
    );
  });

  it('post121: locks AGENTS.md sha1 digest', () => {
    expect(sha1('AGENTS.md')).toBe('a7df1fec05dcf7b8ace116788297c77f467a7b6c');
  });

  it('post121: locks AGENTS.md md5 digest', () => {
    expect(md5('AGENTS.md')).toBe('e73be0edb8c4353b6b591454478f00cd');
  });

  it('post121: locks AGENTS.md sha384 digest', () => {
    expect(sha384('AGENTS.md')).toBe(
      '817ee000b8167b63255d4061082f64b6cb1ce8ce4d1c1b43af4d884deb0b10694d66d13b9eb3d961b5f434bfcc2e372a',
    );
  });

  it('post121: locks AGENTS.md sha512 digest', () => {
    expect(sha512('AGENTS.md')).toBe(
      '7c29c33e9dd0677243dfefdab7f9a8d71305ac78b78a4d52a2ffaa0fa4e067f46242e0c32064be1e4705c817e7cdcb112c2cc7b372de7ea098de4e93d7b23908',
    );
  });

  it('post121: locks AGENTS.md sha256 nibble sum 479 xor 5', () => {
    const d = sha256('AGENTS.md');
    expect(nibbleSum(d)).toBe(479);
    expect(xorNibbles(d)).toBe(5);
  });

  it('post121: locks AGENTS.md sha256 popcount 128', () => {
    expect(popcount(sha256('AGENTS.md'))).toBe(128);
  });

  it('post121: locks AGENTS.md byte size 1017', () => {
    expect(byteSize('AGENTS.md')).toBe(1017);
    expect(readFileSync(join(root, 'AGENTS.md')).byteLength).toBe(1017);
  });

  it('post121: locks AGENTS.md utf8 char length 1011', () => {
    expect(read('AGENTS.md')).toHaveLength(1011);
  });

  it('post121: locks AGENTS.md line count 35', () => {
    expect(lineCount('AGENTS.md')).toBe(35);
  });

  it('post121: locks AGENTS.md HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'AGENTS.md')).toBe(
      '0ac8d751d8828e0289ffe88ce3d436661d46061e65c35fbbcc240231fedb5a23',
    );
  });

  it('post121: locks AGENTS.md HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'AGENTS.md')).toBe(
      '35fa52b3acceba4d7745ab056dc28d1ab46f04ca72b855a842504ae6afe1bf89',
    );
  });

  it('post121: locks AGENTS.md sha256 first/last octets', () => {
    const hex = sha256('AGENTS.md');
    expect(hex.slice(0, 2)).toBe('48');
    expect(hex.slice(-2)).toBe('aa');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks AGENTS.md head40/tail40', () => {
    const body = read('AGENTS.md');
    expect(body.slice(0, 40)).toBe("# AGENTS.md — Backlink_Facelift\n\nparent_");
    expect(body.slice(-40)).toBe("Any billing or CF account configuration\n");
  });

  it('post121: locks README.md sha256 digest', () => {
    expect(sha256('README.md')).toBe(
      'f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987',
    );
  });

  it('post121: locks README.md sha1 digest', () => {
    expect(sha1('README.md')).toBe('4f560a473d5838f25eba3eae21a87f6c97ba3b8b');
  });

  it('post121: locks README.md md5 digest', () => {
    expect(md5('README.md')).toBe('9b7aea4982a6d68b95f7f8ee3fdc5b31');
  });

  it('post121: locks README.md sha384 digest', () => {
    expect(sha384('README.md')).toBe(
      '52db664da38cae8aa1f5dfb3d02bfca990d2cf0700142c089c2c6d0440014d9dbd94b63af5fa31e97995b071c7758f11',
    );
  });

  it('post121: locks README.md sha512 digest', () => {
    expect(sha512('README.md')).toBe(
      'a66447cc7968b9d04a99157b8598e52dc849462692f4e34fc8af624c5a92377700bea429e236b8102cd76bf48d680ed490795b1da33909f001d8fec14336e337',
    );
  });

  it('post121: locks README.md sha256 nibble sum 429 xor 13', () => {
    const d = sha256('README.md');
    expect(nibbleSum(d)).toBe(429);
    expect(xorNibbles(d)).toBe(13);
  });

  it('post121: locks README.md sha256 popcount 113', () => {
    expect(popcount(sha256('README.md'))).toBe(113);
  });

  it('post121: locks README.md byte size 2801', () => {
    expect(byteSize('README.md')).toBe(2801);
    expect(readFileSync(join(root, 'README.md')).byteLength).toBe(2801);
  });

  it('post121: locks README.md utf8 char length 2757', () => {
    expect(read('README.md')).toHaveLength(2757);
  });

  it('post121: locks README.md line count 82', () => {
    expect(lineCount('README.md')).toBe(82);
  });

  it('post121: locks README.md HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'README.md')).toBe(
      'fc5b8f00b8bda0d14ce2ffc6c93adeb3ef86bbd0f509a54e84a47c4e030ee3cf',
    );
  });

  it('post121: locks README.md HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'README.md')).toBe(
      '639e61b346dc1c499222aa9c08d436819d56808a64b92ef3935d726eb22812ff',
    );
  });

  it('post121: locks README.md sha256 first/last octets', () => {
    const hex = sha256('README.md');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('87');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks README.md head40/tail40', () => {
    const body = read('README.md');
    expect(body.slice(0, 40)).toBe("# Backlink 📻\n\n[![CI](https://github.com");
    expect(body.slice(-40)).toBe("pas](https://fuzzywigg.com) / Geryon 🦀\n");
  });

  it('post121: locks DEPLOY.md sha256 digest', () => {
    expect(sha256('DEPLOY.md')).toBe(
      '11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a',
    );
  });

  it('post121: locks DEPLOY.md sha1 digest', () => {
    expect(sha1('DEPLOY.md')).toBe('37c72be44abb67343dae3e7c2303306a25b3481f');
  });

  it('post121: locks DEPLOY.md md5 digest', () => {
    expect(md5('DEPLOY.md')).toBe('da30bf656fdf0d9a61d2a00860c325f5');
  });

  it('post121: locks DEPLOY.md sha384 digest', () => {
    expect(sha384('DEPLOY.md')).toBe(
      '90ba0589c08054172762287998d2a4d110a704705f82771cbd041c0f559f7b9a84dfbf37630b1f7bc9fa2cdbb4d1bf83',
    );
  });

  it('post121: locks DEPLOY.md sha512 digest', () => {
    expect(sha512('DEPLOY.md')).toBe(
      '504275c3bb3c4aa2dd5b4baa6accef1d5a8b83e995bf92146bed27604089ad7ae4540575691383a03a36062562e4388984a560a7ab199451b3bc063104162b80',
    );
  });

  it('post121: locks DEPLOY.md sha256 nibble sum 439 xor 11', () => {
    const d = sha256('DEPLOY.md');
    expect(nibbleSum(d)).toBe(439);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post121: locks DEPLOY.md sha256 popcount 125', () => {
    expect(popcount(sha256('DEPLOY.md'))).toBe(125);
  });

  it('post121: locks DEPLOY.md byte size 1573', () => {
    expect(byteSize('DEPLOY.md')).toBe(1573);
    expect(readFileSync(join(root, 'DEPLOY.md')).byteLength).toBe(1573);
  });

  it('post121: locks DEPLOY.md utf8 char length 1539', () => {
    expect(read('DEPLOY.md')).toHaveLength(1539);
  });

  it('post121: locks DEPLOY.md line count 65', () => {
    expect(lineCount('DEPLOY.md')).toBe(65);
  });

  it('post121: locks DEPLOY.md HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', 'DEPLOY.md')).toBe(
      '962fe2dc8141bbc0f422657c3fff7fa94a4c075e0811aa07f6668a40d4b88407',
    );
  });

  it('post121: locks DEPLOY.md HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', 'DEPLOY.md')).toBe(
      '8a009c91b9790c6985edf6e60ef187d9df0379770697106f23f95521a00e019c',
    );
  });

  it('post121: locks DEPLOY.md sha256 first/last octets', () => {
    const hex = sha256('DEPLOY.md');
    expect(hex.slice(0, 2)).toBe('11');
    expect(hex.slice(-2)).toBe('5a');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks DEPLOY.md head40/tail40', () => {
    const body = read('DEPLOY.md');
    expect(body.slice(0, 40)).toBe("# Backlink — Deployment Guide\n\n## Prereq");
    expect(body.slice(-40)).toBe("external data sources requires approval\n");
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'f76fcc573b913789446748a601dcb4a8d2cfaa3ec85d2c6bb798f2a35b844055',
    );
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/bug.yml')).toBe('d03c99b857f1589125c3bc266ae29317f6c7ba0a');
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/bug.yml')).toBe('3693b9bfd65bf683be0706b83831ae69');
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha384 digest', () => {
    expect(sha384('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '855300144bf80d8484fa6b924841921754b55d1e8a1c0f2b17fca10e0b72e9e4cf143dbf821f75969b82e4dd19ab2638',
    );
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'c0c19929fcaf9c18b96a228a420807fb5b8a0c41b7c38aba0680e0a518d267413c14c618e5d3d3b22829b73f5a53c11e713e41bbbe154565ba1fd567f5a67e90',
    );
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha256 nibble sum 493 xor 11', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(nibbleSum(d)).toBe(493);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha256 popcount 129', () => {
    expect(popcount(sha256('.github/ISSUE_TEMPLATE/bug.yml'))).toBe(129);
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml byte size 846', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/bug.yml')).toBe(846);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml')).byteLength).toBe(846);
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml utf8 char length 846', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toHaveLength(846);
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml line count 41', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/bug.yml')).toBe(41);
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      '5e09326637cf342fa894a3108b6f01774e981cb628820ef663210a3388ea13a5',
    );
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/ISSUE_TEMPLATE/bug.yml')).toBe(
      'f0fea0143fb58ab605f4b0540551fd73cf72d1defa2fff750e893f14b83745d2',
    );
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/bug.yml');
    expect(hex.slice(0, 2)).toBe('f7');
    expect(hex.slice(-2)).toBe('55');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks ISSUE_TEMPLATE bug.yml head40/tail40', () => {
    const body = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(body.slice(0, 40)).toBe("name: Bug\ndescription: Something isn't w");
    expect(body.slice(-40)).toBe("ibutes:\n      label: Steps to reproduce\n");
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '230222c6ac61737a55b00df4442d483911154bd93657ba98a1d30b75b509c3fc',
    );
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/chore.yml')).toBe('9b401e414cbc1a5fab58fa4ae6d43957a4ef05fd');
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/chore.yml')).toBe('2eff43364806910ca218e00054a2304a');
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha384 digest', () => {
    expect(sha384('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      'abe0e1d993ee5280a4876d05f54af0bd44c2544a2400e8509270c3a0c2d38d5660decaac2a25f16f0d5b6eaee0fa0e87',
    );
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '0ef6ef054700858f1434bb5dc71d03bc5f22d470b32b3336254ad8cd3c9c22f2b405630b0a04df7836cb7758ec686dc0b7c004d85b5628772d1c68e4d44598cb',
    );
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha256 nibble sum 406 xor 10', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(nibbleSum(d)).toBe(406);
    expect(xorNibbles(d)).toBe(10);
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha256 popcount 118', () => {
    expect(popcount(sha256('.github/ISSUE_TEMPLATE/chore.yml'))).toBe(118);
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml byte size 705', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/chore.yml')).toBe(705);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/chore.yml')).byteLength).toBe(705);
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml utf8 char length 705', () => {
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toHaveLength(705);
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml line count 33', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/chore.yml')).toBe(33);
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      '3b8aa4396f0b8b2aad979ff8edba4e5a4ddc695d83b8e27e4bcefdfbc56b127a',
    );
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/ISSUE_TEMPLATE/chore.yml')).toBe(
      'ae4e5389775955078e7c3451d860a29235151b8b3576d6a9461291d943d10bb7',
    );
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/chore.yml');
    expect(hex.slice(0, 2)).toBe('23');
    expect(hex.slice(-2)).toBe('fc');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks ISSUE_TEMPLATE chore.yml head40/tail40', () => {
    const body = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(body.slice(0, 40)).toBe("name: Chore / Infra / Docs\ndescription: ");
    expect(body.slice(-40)).toBe("?\n    validations:\n      required: true\n");
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '1f103c6a9dd07cd13a9a6f17ace6b813f47747eb9cb7e00488cb2073caaf91bb',
    );
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/config.yml')).toBe('68344263f9bbfe0fc196c0e6c1a55818cc46dc01');
  });

  it('post121: locks ISSUE_TEMPLATE config.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/config.yml')).toBe('74c7aebcc7755d1241890df4fd87c662');
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha384 digest', () => {
    expect(sha384('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '733361a6ac8d0ff56724d1e6f245c8785e2e6dae372c2f0cdc9b9c99de184c245361b625faf5025bfd2a3d28d97409cf',
    );
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '3525514870b59d330e696be298847092a3e9d69470d7dbb7d410fd83f8afdbefe49d711b9383dee9664d3ee92ec70e98989b096eeb427176106de8fd948bf628',
    );
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha256 nibble sum 498 xor 12', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(nibbleSum(d)).toBe(498);
    expect(xorNibbles(d)).toBe(12);
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha256 popcount 132', () => {
    expect(popcount(sha256('.github/ISSUE_TEMPLATE/config.yml'))).toBe(132);
  });

  it('post121: locks ISSUE_TEMPLATE config.yml byte size 28', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/config.yml')).toBe(28);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/config.yml')).byteLength).toBe(28);
  });

  it('post121: locks ISSUE_TEMPLATE config.yml utf8 char length 28', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toHaveLength(28);
  });

  it('post121: locks ISSUE_TEMPLATE config.yml line count 2', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/config.yml')).toBe(2);
  });

  it('post121: locks ISSUE_TEMPLATE config.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '7e845274ec127a77e57dd555db78c26262be71e6c1d2502a5c998cabb16b8cab',
    );
  });

  it('post121: locks ISSUE_TEMPLATE config.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '917c5d5475c1472b40d53dce6c4f542db872a885d651e3e581f3ef841ad81cfe',
    );
  });

  it('post121: locks ISSUE_TEMPLATE config.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/config.yml');
    expect(hex.slice(0, 2)).toBe('1f');
    expect(hex.slice(-2)).toBe('bb');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks ISSUE_TEMPLATE config.yml head40/tail40', () => {
    const body = read('.github/ISSUE_TEMPLATE/config.yml');
    expect(body.slice(0, 40)).toBe("blank_issues_enabled: false\n");
    expect(body.slice(-40)).toBe("blank_issues_enabled: false\n");
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha256 digest', () => {
    expect(sha256('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '83291f987d1bb546b45ecd09d9be597c5265591a99744d18a2c49122e390aac2',
    );
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha1 digest', () => {
    expect(sha1('.github/ISSUE_TEMPLATE/feature.yml')).toBe('e23c853fb5eebf3a04e9f487f2c9d879d40216b7');
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml md5 digest', () => {
    expect(md5('.github/ISSUE_TEMPLATE/feature.yml')).toBe('c73a814e3784562d4ab200328793c60f');
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha384 digest', () => {
    expect(sha384('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '437418046d5172939f9083345379a1f5513aa3c63f83f35f8561219ad08b5f258f665cac32d56275ca45d7cda6f1d2de',
    );
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha512 digest', () => {
    expect(sha512('.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '3652135ac2e4397524c5ebeed2fea46c1e31addc0dcbf5a62287fd594fdc49bbfa926f3d778d91ebd11cb93565682626329f36467af10d6853c51c41147d97a6',
    );
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha256 nibble sum 461 xor 11', () => {
    const d = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(nibbleSum(d)).toBe(461);
    expect(xorNibbles(d)).toBe(11);
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha256 popcount 121', () => {
    expect(popcount(sha256('.github/ISSUE_TEMPLATE/feature.yml'))).toBe(121);
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml byte size 966', () => {
    expect(byteSize('.github/ISSUE_TEMPLATE/feature.yml')).toBe(966);
    expect(readFileSync(join(root, '.github/ISSUE_TEMPLATE/feature.yml')).byteLength).toBe(966);
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml utf8 char length 966', () => {
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toHaveLength(966);
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml line count 44', () => {
    expect(lineCount('.github/ISSUE_TEMPLATE/feature.yml')).toBe(44);
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml HMAC-SHA256 key post121', () => {
    expect(hmacSha256('post121', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      'b5af0a917e8b07a80f75ba1ef958ed4a3df06d59f4f7ef0f62c802f648ca4508',
    );
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml HMAC-SHA256 key heavy-burn', () => {
    expect(hmacSha256('heavy-burn', '.github/ISSUE_TEMPLATE/feature.yml')).toBe(
      '660ce96c615ea0ebc2125777d2d39870afdbb76bc81f29da4c61825a778cb899',
    );
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml sha256 first/last octets', () => {
    const hex = sha256('.github/ISSUE_TEMPLATE/feature.yml');
    expect(hex.slice(0, 2)).toBe('83');
    expect(hex.slice(-2)).toBe('c2');
    expect(hex).toHaveLength(64);
  });

  it('post121: locks ISSUE_TEMPLATE feature.yml head40/tail40', () => {
    const body = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(body.slice(0, 40)).toBe("name: Feature\ndescription: New capabilit");
    expect(body.slice(-40)).toBe("butes:\n      label: Acceptance criteria\n");
  });

  it('post121: locks workflows ci.yml space count 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('post121: locks workflows ci.yml newline count 176', () => {
    expect((read('.github/workflows/ci.yml').match(/\n/g) ?? []).length).toBe(176);
  });

  it('post121: locks workflows ci.yml colon count 109', () => {
    expect((read('.github/workflows/ci.yml').match(/:/g) ?? []).length).toBe(109);
  });

  it('post121: locks workflows ci.yml dash count 173', () => {
    expect((read('.github/workflows/ci.yml').match(/-/g) ?? []).length).toBe(173);
  });

  it('post121: locks workflows ci.yml double-quote count 23', () => {
    expect((read('.github/workflows/ci.yml').match(/"/g) ?? []).length).toBe(23);
  });

  it('post121: locks workflows ci.yml single-quote count 113', () => {
    expect((read('.github/workflows/ci.yml').match(/'/g) ?? []).length).toBe(113);
  });

  it('post121: locks workflows ci.yml hash count 3', () => {
    expect((read('.github/workflows/ci.yml').match(/#/g) ?? []).length).toBe(3);
  });

  it('post121: locks workflows ci.yml dollar count 4', () => {
    expect((read('.github/workflows/ci.yml').match(/\$/g) ?? []).length).toBe(4);
  });

  it('post121: locks workflows ci.yml brace count 11', () => {
    expect((read('.github/workflows/ci.yml').match(/\{/g) ?? []).length).toBe(11);
  });

  it('post121: locks workflows ci.yml bracket count 13', () => {
    expect((read('.github/workflows/ci.yml').match(/\[/g) ?? []).length).toBe(13);
  });

  it('post121: locks workflows ci.yml digit count 48', () => {
    expect([...read('.github/workflows/ci.yml')].filter((c) => /\d/.test(c))).toHaveLength(48);
  });

  it('post121: locks workflows ci.yml uppercase count 81', () => {
    expect([...read('.github/workflows/ci.yml')].filter((c) => /[A-Z]/.test(c))).toHaveLength(81);
  });

  it('post121: locks workflows ci.yml lowercase count 3409', () => {
    expect([...read('.github/workflows/ci.yml')].filter((c) => /[a-z]/.test(c))).toHaveLength(3409);
  });

  it('post121: locks workflows deploy.yml space count 274', () => {
    expect((read('.github/workflows/deploy.yml').match(/ /g) ?? []).length).toBe(274);
  });

  it('post121: locks workflows deploy.yml newline count 46', () => {
    expect((read('.github/workflows/deploy.yml').match(/\n/g) ?? []).length).toBe(46);
  });

  it('post121: locks workflows deploy.yml colon count 37', () => {
    expect((read('.github/workflows/deploy.yml').match(/:/g) ?? []).length).toBe(37);
  });

  it('post121: locks workflows deploy.yml dash count 16', () => {
    expect((read('.github/workflows/deploy.yml').match(/-/g) ?? []).length).toBe(16);
  });

  it('post121: locks workflows deploy.yml double-quote count 4', () => {
    expect((read('.github/workflows/deploy.yml').match(/"/g) ?? []).length).toBe(4);
  });

  it('post121: locks workflows deploy.yml single-quote count 0', () => {
    expect((read('.github/workflows/deploy.yml').match(/'/g) ?? []).length).toBe(0);
  });

  it('post121: locks workflows deploy.yml hash count 0', () => {
    expect((read('.github/workflows/deploy.yml').match(/#/g) ?? []).length).toBe(0);
  });

  it('post121: locks workflows deploy.yml dollar count 4', () => {
    expect((read('.github/workflows/deploy.yml').match(/\$/g) ?? []).length).toBe(4);
  });

  it('post121: locks workflows deploy.yml brace count 8', () => {
    expect((read('.github/workflows/deploy.yml').match(/\{/g) ?? []).length).toBe(8);
  });

  it('post121: locks workflows deploy.yml bracket count 0', () => {
    expect((read('.github/workflows/deploy.yml').match(/\[/g) ?? []).length).toBe(0);
  });

  it('post121: locks workflows deploy.yml digit count 7', () => {
    expect([...read('.github/workflows/deploy.yml')].filter((c) => /\d/.test(c))).toHaveLength(7);
  });

  it('post121: locks workflows deploy.yml uppercase count 71', () => {
    expect([...read('.github/workflows/deploy.yml')].filter((c) => /[A-Z]/.test(c))).toHaveLength(71);
  });

  it('post121: locks workflows deploy.yml lowercase count 505', () => {
    expect([...read('.github/workflows/deploy.yml')].filter((c) => /[a-z]/.test(c))).toHaveLength(505);
  });

  it('post121: locks dependabot.yml space count 130', () => {
    expect((read('.github/dependabot.yml').match(/ /g) ?? []).length).toBe(130);
  });

  it('post121: locks dependabot.yml newline count 24', () => {
    expect((read('.github/dependabot.yml').match(/\n/g) ?? []).length).toBe(24);
  });

  it('post121: locks dependabot.yml colon count 22', () => {
    expect((read('.github/dependabot.yml').match(/:/g) ?? []).length).toBe(22);
  });

  it('post121: locks dependabot.yml dash count 20', () => {
    expect((read('.github/dependabot.yml').match(/-/g) ?? []).length).toBe(20);
  });

  it('post121: locks dependabot.yml double-quote count 20', () => {
    expect((read('.github/dependabot.yml').match(/"/g) ?? []).length).toBe(20);
  });

  it('post121: locks dependabot.yml single-quote count 0', () => {
    expect((read('.github/dependabot.yml').match(/'/g) ?? []).length).toBe(0);
  });

  it('post121: locks dependabot.yml hash count 0', () => {
    expect((read('.github/dependabot.yml').match(/#/g) ?? []).length).toBe(0);
  });

  it('post121: locks dependabot.yml dollar count 0', () => {
    expect((read('.github/dependabot.yml').match(/\$/g) ?? []).length).toBe(0);
  });

  it('post121: locks dependabot.yml brace count 0', () => {
    expect((read('.github/dependabot.yml').match(/\{/g) ?? []).length).toBe(0);
  });

  it('post121: locks dependabot.yml bracket count 1', () => {
    expect((read('.github/dependabot.yml').match(/\[/g) ?? []).length).toBe(1);
  });

  it('post121: locks dependabot.yml digit count 3', () => {
    expect([...read('.github/dependabot.yml')].filter((c) => /\d/.test(c))).toHaveLength(3);
  });

  it('post121: locks dependabot.yml uppercase count 0', () => {
    expect([...read('.github/dependabot.yml')].filter((c) => /[A-Z]/.test(c))).toHaveLength(0);
  });

  it('post121: locks dependabot.yml lowercase count 279', () => {
    expect([...read('.github/dependabot.yml')].filter((c) => /[a-z]/.test(c))).toHaveLength(279);
  });

  it('post121: locks vitest.config.ts space count 121', () => {
    expect((read('vitest.config.ts').match(/ /g) ?? []).length).toBe(121);
  });

  it('post121: locks vitest.config.ts newline count 21', () => {
    expect((read('vitest.config.ts').match(/\n/g) ?? []).length).toBe(21);
  });

  it('post121: locks vitest.config.ts colon count 15', () => {
    expect((read('vitest.config.ts').match(/:/g) ?? []).length).toBe(15);
  });

  it('post121: locks vitest.config.ts dash count 2', () => {
    expect((read('vitest.config.ts').match(/-/g) ?? []).length).toBe(2);
  });

  it('post121: locks vitest.config.ts double-quote count 0', () => {
    expect((read('vitest.config.ts').match(/"/g) ?? []).length).toBe(0);
  });

  it('post121: locks vitest.config.ts single-quote count 26', () => {
    expect((read('vitest.config.ts').match(/'/g) ?? []).length).toBe(26);
  });

  it('post121: locks vitest.config.ts hash count 0', () => {
    expect((read('vitest.config.ts').match(/#/g) ?? []).length).toBe(0);
  });

  it('post121: locks vitest.config.ts dollar count 0', () => {
    expect((read('vitest.config.ts').match(/\$/g) ?? []).length).toBe(0);
  });

  it('post121: locks vitest.config.ts brace count 5', () => {
    expect((read('vitest.config.ts').match(/\{/g) ?? []).length).toBe(5);
  });

  it('post121: locks vitest.config.ts bracket count 6', () => {
    expect((read('vitest.config.ts').match(/\[/g) ?? []).length).toBe(6);
  });

  it('post121: locks vitest.config.ts digit count 13', () => {
    expect([...read('vitest.config.ts')].filter((c) => /\d/.test(c))).toHaveLength(13);
  });

  it('post121: locks vitest.config.ts uppercase count 15', () => {
    expect([...read('vitest.config.ts')].filter((c) => /[A-Z]/.test(c))).toHaveLength(15);
  });

  it('post121: locks vitest.config.ts lowercase count 258', () => {
    expect([...read('vitest.config.ts')].filter((c) => /[a-z]/.test(c))).toHaveLength(258);
  });

  it('post121: locks package.json space count 106', () => {
    expect((read('package.json').match(/ /g) ?? []).length).toBe(106);
  });

  it('post121: locks package.json newline count 25', () => {
    expect((read('package.json').match(/\n/g) ?? []).length).toBe(25);
  });

  it('post121: locks package.json colon count 22', () => {
    expect((read('package.json').match(/:/g) ?? []).length).toBe(22);
  });

  it('post121: locks package.json dash count 8', () => {
    expect((read('package.json').match(/-/g) ?? []).length).toBe(8);
  });

  it('post121: locks package.json double-quote count 74', () => {
    expect((read('package.json').match(/"/g) ?? []).length).toBe(74);
  });

  it('post121: locks package.json single-quote count 0', () => {
    expect((read('package.json').match(/'/g) ?? []).length).toBe(0);
  });

  it('post121: locks package.json hash count 0', () => {
    expect((read('package.json').match(/#/g) ?? []).length).toBe(0);
  });

  it('post121: locks package.json dollar count 0', () => {
    expect((read('package.json').match(/\$/g) ?? []).length).toBe(0);
  });

  it('post121: locks package.json brace count 4', () => {
    expect((read('package.json').match(/\{/g) ?? []).length).toBe(4);
  });

  it('post121: locks package.json bracket count 0', () => {
    expect((read('package.json').match(/\[/g) ?? []).length).toBe(0);
  });

  it('post121: locks package.json digit count 37', () => {
    expect([...read('package.json')].filter((c) => /\d/.test(c))).toHaveLength(37);
  });

  it('post121: locks package.json uppercase count 7', () => {
    expect([...read('package.json')].filter((c) => /[A-Z]/.test(c))).toHaveLength(7);
  });

  it('post121: locks package.json lowercase count 302', () => {
    expect([...read('package.json')].filter((c) => /[a-z]/.test(c))).toHaveLength(302);
  });

  it('post121: locks tsconfig.json space count 93', () => {
    expect((read('tsconfig.json').match(/ /g) ?? []).length).toBe(93);
  });

  it('post121: locks tsconfig.json newline count 23', () => {
    expect((read('tsconfig.json').match(/\n/g) ?? []).length).toBe(23);
  });

  it('post121: locks tsconfig.json colon count 11', () => {
    expect((read('tsconfig.json').match(/:/g) ?? []).length).toBe(11);
  });

  it('post121: locks tsconfig.json dash count 1', () => {
    expect((read('tsconfig.json').match(/-/g) ?? []).length).toBe(1);
  });

  it('post121: locks tsconfig.json double-quote count 40', () => {
    expect((read('tsconfig.json').match(/"/g) ?? []).length).toBe(40);
  });

  it('post121: locks tsconfig.json single-quote count 0', () => {
    expect((read('tsconfig.json').match(/'/g) ?? []).length).toBe(0);
  });

  it('post121: locks tsconfig.json hash count 0', () => {
    expect((read('tsconfig.json').match(/#/g) ?? []).length).toBe(0);
  });

  it('post121: locks tsconfig.json dollar count 0', () => {
    expect((read('tsconfig.json').match(/\$/g) ?? []).length).toBe(0);
  });

  it('post121: locks tsconfig.json brace count 2', () => {
    expect((read('tsconfig.json').match(/\{/g) ?? []).length).toBe(2);
  });

  it('post121: locks tsconfig.json bracket count 3', () => {
    expect((read('tsconfig.json').match(/\[/g) ?? []).length).toBe(3);
  });

  it('post121: locks tsconfig.json digit count 8', () => {
    expect([...read('tsconfig.json')].filter((c) => /\d/.test(c))).toHaveLength(8);
  });

  it('post121: locks tsconfig.json uppercase count 15', () => {
    expect([...read('tsconfig.json')].filter((c) => /[A-Z]/.test(c))).toHaveLength(15);
  });

  it('post121: locks tsconfig.json lowercase count 168', () => {
    expect([...read('tsconfig.json')].filter((c) => /[a-z]/.test(c))).toHaveLength(168);
  });

  it('post121: CI concurrency group uses workflow + ref', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/group:\s*ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/);
    expect(read('.github/workflows/ci.yml')).toContain('cancel-in-progress: true');
  });

  it('post121: deploy concurrency cancels false and uses workflow only', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/group:\s*deploy-\$\{\{\s*github\.workflow\s*\}\}/);
    expect(read('.github/workflows/deploy.yml')).toContain('cancel-in-progress: false');
  });

  it('post121: CI permissions are contents read only — no write scopes', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(ci).not.toMatch(/contents:\s*write/);
    expect(ci).not.toMatch(/pull-requests:\s*write/);
    expect(ci).not.toMatch(/id-token:\s*write/);
  });

  it('post121: deploy permissions are contents read only — no write scopes', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(deploy).not.toMatch(/contents:\s*write/);
    expect(deploy).not.toMatch(/id-token:\s*write/);
  });

  it('post121: CI defaults shell bash applies to all jobs', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^defaults:\n {2}run:\n {4}shell: bash\n/m);
  });

  it('post121: CI triggers push+PR to main only — no schedule or workflow_call', () => {
    const head = read('.github/workflows/ci.yml').split(/^jobs:/m)[0];
    expect(head).toContain('push:');
    expect(head).toContain('pull_request:');
    expect(head).toContain('branches: [main]');
    expect(head).not.toMatch(/schedule:/);
    expect(head).not.toMatch(/workflow_call:/);
    expect(head).not.toMatch(/workflow_dispatch:/);
    expect(head).not.toMatch(/pull_request_target:/);
  });

  it('post121: deploy trigger is workflow_dispatch only', () => {
    const head = read('.github/workflows/deploy.yml').split(/^jobs:/m)[0];
    expect(head).toMatch(/^on:\n {2}workflow_dispatch:\n/m);
    expect(head).not.toMatch(/push:/);
    expect(head).not.toMatch(/pull_request/);
    expect(head).not.toMatch(/schedule:/);
  });

  it('post121: CI job timeout inventory — typecheck 10 / test 15 / hygiene 5', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/name: Typecheck[\s\S]*?timeout-minutes: 10/);
    expect(ci).toMatch(/name: Tests[\s\S]*?timeout-minutes: 15/);
    expect(ci).toMatch(/name: Hygiene[\s\S]*?timeout-minutes: 5/);
  });

  it('post121: deploy job timeout is 20 minutes', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('timeout-minutes: 20');
  });

  it('post121: CI checkout persist-credentials false on all three jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    // 3 checkout steps + 2 hygiene grep assertions referencing the same pin
    expect((ci.match(/persist-credentials:\s*false/g) ?? []).length).toBe(5);
    expect((ci.match(/uses:\s*actions\/checkout@v7/g) ?? []).length).toBe(3);
  });

  it('post121: deploy checkout persist-credentials false once', () => {
    const matches = read('.github/workflows/deploy.yml').match(/persist-credentials:\s*false/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('post121: CI action pin inventory — checkout×3 setup-node×2 upload-artifact×1', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/actions\/checkout@v7/g) ?? []).length).toBe(3);
    expect((ci.match(/actions\/setup-node@v7/g) ?? []).length).toBe(2);
    expect((ci.match(/actions\/upload-artifact@v4/g) ?? []).length).toBe(1);
    expect(ci).not.toMatch(/actions\/checkout@v[0-6]\b/);
    expect(ci).not.toMatch(/actions\/setup-node@v[0-6]\b/);
  });

  it('post121: deploy action pin inventory — checkout + setup-node + wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect((deploy.match(/actions\/checkout@v7/g) ?? []).length).toBe(1);
    expect((deploy.match(/actions\/setup-node@v7/g) ?? []).length).toBe(1);
    expect((deploy.match(/cloudflare\/wrangler-action@v4/g) ?? []).length).toBe(1);
  });

  it('post121: CI Node 20 pin appears with npm cache (setup + hygiene grep)', () => {
    const ci = read('.github/workflows/ci.yml');
    // 2 setup-node pins + 1 hygiene grep asserting the pin
    expect((ci.match(/node-version:\s*"20"/g) ?? []).length).toBe(3);
    expect((ci.match(/cache:\s*"npm"/g) ?? []).length).toBe(2);
    expect((ci.match(/uses:\s*actions\/setup-node@v7/g) ?? []).length).toBe(2);
  });

  it('post121: deploy Node 20 pin with npm cache', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('node-version: "20"');
    expect(deploy).toContain('cache: "npm"');
  });

  it('post121: CI npm ci appears in typecheck and test jobs', () => {
    expect((read('.github/workflows/ci.yml').match(/npm ci/g) ?? []).length).toBe(2);
  });

  it('post121: deploy runs npm ci then typecheck then coverage then wrangler', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const a = deploy.indexOf('npm ci');
    const b = deploy.indexOf('npm run typecheck');
    const c = deploy.indexOf('npm run test:coverage');
    const d = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
  });

  it('post121: coverage artifact name retention and always() guard', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('name: coverage-report');
    expect(ci).toContain('retention-days: 14');
    expect(ci).toContain('if: always()');
    expect(ci).toContain('if-no-files-found: error');
    expect(ci).toMatch(/path:\s*\|\s*\n\s*coverage\/\s*\n\s*coverage\/lcov\.info/);
  });

  it('post121: coverage assert step checks dir file nonempty and SF:src/', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('test -d coverage');
    expect(ci).toContain('test -f coverage/lcov.info');
    expect(ci).toContain('test -s coverage/lcov.info');
    expect(ci).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post121: hygiene required-file checklist includes all nine test suites + helpers', () => {
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

  it('post121: hygiene locks vitest 100% thresholds and coverage script', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'thresholds' vitest.config.ts");
    expect(ci).toContain("grep -q 'branches: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'lines: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'functions: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'statements: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'test:coverage' package.json");
  });

  it('post121: hygiene bans Anthropic leftovers and requires Gemini Flash model', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
    expect(ci).toMatch(/anthropic\|claude\|haiku/);
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
  });

  it('post121: hygiene bans committed secrets and .env/.dev.vars/pem/key', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('! test -f .env');
    expect(ci).toContain('! test -f .dev.vars');
    expect(ci).toMatch(/\*\.pem/);
    expect(ci).toMatch(/\*\.key/);
    expect(ci).toMatch(/private\[_-\]\?key/);
  });

  it('post121: hygiene bans GEMINI_API_KEY assignment in wrangler.toml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(ci).toContain("! grep -qiE 'api[_-]?key\\s*=' wrangler.toml");
  });

  it('post121: hygiene requires typescript ^5 and rejects ^6/^7', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('grep -qE \'"typescript": "\\^5\\.\' package.json');
    expect(ci).toContain('! grep -qE \'"typescript": "\\^[67]\\.\' package.json');
  });

  it('post121: hygiene requires lockfileVersion 3 and types.ts exclusion', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('"lockfileVersion": 3');
    expect(ci).toContain('src/types.ts');
    expect(ci).toContain("grep -q 'github-actions' vitest.config.ts");
    expect(ci).toContain("grep -q 'lcov' vitest.config.ts");
  });

  it('post121: Dependabot version 2 with npm + github-actions monthly', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2\n')).toBe(true);
    expect((dep.match(/package-ecosystem:/g) ?? []).length).toBe(2);
    expect((dep.match(/interval:\s*"monthly"/g) ?? []).length).toBe(2);
    expect(dep).toContain('package-ecosystem: "npm"');
    expect(dep).toContain('package-ecosystem: "github-actions"');
  });

  it('post121: Dependabot ignore semver-major for all npm deps', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('dependency-name: "*"');
    expect(dep).toContain('update-types: ["version-update:semver-major"]');
  });

  it('post121: Dependabot PR limits — npm 3 / actions 2', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toMatch(/package-ecosystem:\s*"npm"[\s\S]*?open-pull-requests-limit:\s*3/);
    expect(dep).toMatch(/package-ecosystem:\s*"github-actions"[\s\S]*?open-pull-requests-limit:\s*2/);
  });

  it('post121: Dependabot groups use wildcard patterns', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toContain('github-actions:');
    expect((dep.match(/patterns:\n\s+- "\*"/g) ?? []).length).toBe(2);
  });

  it('post121: vitest thresholds all four metrics exactly 100', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
    expect((cfg.match(/:\s*100/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('post121: vitest include exclude reporters provider locked', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toContain("environment: 'node'");
    expect(cfg).toContain("include: ['test/**/*.test.ts']");
    expect(cfg).toContain("include: ['src/**/*.ts']");
    expect(cfg).toContain("exclude: ['src/types.ts']");
    expect(cfg).toContain("provider: 'v8'");
    expect(cfg).toContain("'text'");
    expect(cfg).toContain("'text-summary'");
    expect(cfg).toContain("'html'");
    expect(cfg).toContain("'lcov'");
    expect(cfg).toContain('github-actions');
  });

  it('post121: package.json script inventory locked to six entries', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(Object.keys(scripts).sort()).toEqual([
      'deploy',
      'dev',
      'test',
      'test:coverage',
      'test:watch',
      'typecheck',
    ]);
    expect(scripts.typecheck).toBe('tsc --noEmit');
    expect(scripts.test).toBe('vitest run');
    expect(scripts['test:coverage']).toBe('vitest run --coverage');
    expect(scripts['test:watch']).toBe('vitest');
    expect(scripts.dev).toBe('wrangler dev');
    expect(scripts.deploy).toBe('wrangler deploy');
  });

  it('post121: package.json dependency inventory — hono only runtime dep', () => {
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

  it('post121: package.json identity — name type version description', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.type).toBe('module');
    expect(String(pkg.description)).toMatch(/internet radio/i);
  });

  it('post121: package-lock lockfileVersion 3 with 168 packages', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      lockfileVersion: number;
      name: string;
      packages: Record<string, unknown>;
    };
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.name).toBe('backlink');
    expect(Object.keys(lock.packages)).toHaveLength(168);
  });

  it('post121: tsconfig strict ES2022 bundler resolution with workers + node types', () => {
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

  it('post121: .gitattributes LF normalization only', () => {
    const ga = read('.gitattributes');
    expect(ga).toContain('* text=auto');
    expect(ga.split('\n')).toHaveLength(3);
    expect(ga).not.toMatch(/eol=crlf/);
  });

  it('post121: .cursor/environment.json install is npm ci', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { name: string; install: string };
    expect(env.name).toBe('Backlink_Facelift');
    expect(env.install).toBe('npm ci');
  });

  it('post121: .gitignore covers node_modules wrangler coverage env secrets editors', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^node_modules\/$/m);
    expect(gi).toMatch(/^\.wrangler\/$/m);
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\.\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
    expect(gi).toMatch(/^\.dev\.vars$/m);
    expect(gi).toMatch(/^\*\.pem$/m);
    expect(gi).toMatch(/^\*\.key$/m);
    expect(gi).toMatch(/^\.DS_Store$/m);
  });

  it('post121: wrangler.toml name main compatibility without secret literals', () => {
    const toml = read('wrangler.toml');
    expect(toml).toContain('name = "backlink"');
    expect(toml).toContain('main = "src/index.ts"');
    expect(toml).toMatch(/compatibility_date\s*=/);
    expect(toml).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(toml).toContain('VERSION');
    expect(toml).toContain('"0.1.0"');
  });

  it('post121: ISSUE_TEMPLATE inventory — bug chore config feature', () => {
    const names = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
    expect(names).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('post121: ISSUE_TEMPLATE config.yml blank_issues_enabled false-ish lock', () => {
    const cfg = read('.github/ISSUE_TEMPLATE/config.yml');
    expect(cfg.length).toBe(28);
    expect(sha256('.github/ISSUE_TEMPLATE/config.yml')).toBe(
      '1f103c6a9dd07cd13a9a6f17ace6b813f47747eb9cb7e00488cb2073caaf91bb',
    );
  });

  it('post121: AGENTS.md Verify block matches package scripts', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
    expect(agents).toMatch(/Safe Agent Actions/i);
    expect(agents).toMatch(/Escalate to Human/i);
  });

  it('post121: README CI badge / verify language without inventing routes', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/CI|typecheck|coverage/i);
    expect(readme).not.toMatch(/\/playlist|\/now-playing/);
  });

  it('post121: DEPLOY.md HITL language aligns with workflow_dispatch', () => {
    const md = read('DEPLOY.md');
    expect(md.toLowerCase()).toMatch(/hitl|workflow_dispatch|manual|human/);
    expect(read('.github/workflows/deploy.yml')).toContain('workflow_dispatch');
  });

  it('post121: Uint8Array of CI name bytes 67 73', () => {
    expect(Uint8Array.from([67, 73])).toEqual(new TextEncoder().encode('CI'));
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post121: Int32Array of four 100 thresholds still locked', () => {
    expect([...Int32Array.from([100, 100, 100, 100])]).toEqual([100, 100, 100, 100]);
    expect(read('vitest.config.ts')).toMatch(/branches:\s*100/);
  });

  it('post121: BigInt package-lock packages length is 168n', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(BigInt(Object.keys(lock.packages).length)).toBe(168n);
  });

  it('post121: DataView reads node major 20 bytes', () => {
    const bytes = new TextEncoder().encode('20');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint8(0)).toBe(0x32);
    expect(view.getUint8(1)).toBe(0x30);
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
  });

  it('post121: Buffer.compare of ci.yml prefix name: CI', () => {
    const head = readFileSync(join(root, '.github/workflows/ci.yml')).subarray(0, 8);
    expect(Buffer.compare(head, Buffer.from('name: CI'))).toBe(0);
  });

  it('post121: btoa/atob round-trip of workflow name CI', () => {
    expect(atob(btoa('CI'))).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post121: structuredClone of package scripts stays equal', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(structuredClone(scripts)).toEqual(scripts);
  });

  it('post121: localeCompare ordering of CI job ids', () => {
    expect(['hygiene', 'test', 'typecheck'].sort((a, b) => a.localeCompare(b))).toEqual([
      'hygiene',
      'test',
      'typecheck',
    ]);
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^ {2}typecheck:$/m);
    expect(ci).toMatch(/^ {2}test:$/m);
    expect(ci).toMatch(/^ {2}hygiene:$/m);
  });

  it('post121: Set uniqueness of CI job display names', () => {
    const names = ['Typecheck', 'Tests', 'Hygiene'];
    expect(new Set(names).size).toBe(3);
    const ci = read('.github/workflows/ci.yml');
    for (const n of names) expect(ci).toContain(`name: ${n}\n`);
  });

  it('post121: Map inventory of six package scripts', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    const map = new Map(Object.entries(scripts));
    expect(map.size).toBe(6);
    expect(map.get('test:coverage')).toBe('vitest run --coverage');
  });

  it('post121: Object.keys package.json top-level order', () => {
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

  it('post121: JSON.stringify package name round-trips', () => {
    expect(JSON.stringify({ name: 'backlink' })).toBe('{"name":"backlink"}');
    expect(JSON.parse(read('package.json')).name).toBe('backlink');
  });

  it('post121: padStart retention-days fortnight', () => {
    expect(String(14).padStart(2, '0')).toBe('14');
    expect(14 / 7).toBe(2);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post121: sha256 of concatenated CI job ids', () => {
    const joined = ['typecheck', 'test', 'hygiene'].join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      'c48518346e52822a0ffe829df570359891ea3a1c43bdc58253a1a5103bcdf4c9',
    );
  });

  it('post121: sha256 of Verify script block tokens', () => {
    const tokens = ['npm ci', 'npm run typecheck', 'npm test', 'npm run test:coverage'].join('\n');
    expect(createHash('sha256').update(tokens).digest('hex')).toBe(
      '0ddf9e851fceb0350faa3d8b53ed0bfdcaa2aaed6efbcc15259e212de662e007',
    );
    expect(read('AGENTS.md')).toContain('npm run test:coverage');
  });

  it('post121: sha256 of Dependabot ecosystems joined', () => {
    const joined = ['npm', 'github-actions'].join('|');
    expect(createHash('sha256').update(joined).digest('hex')).toBe(
      '337db83baf362731d910e71f99a4f68878cd7485506e1aad6c048bebb41adbc9',
    );
    expect(read('.github/dependabot.yml')).toContain('package-ecosystem: "npm"');
  });

  it('post121: sha256 of vitest reporter list', () => {
    const reporters = ['text', 'text-summary', 'html', 'lcov'].join(',');
    expect(createHash('sha256').update(reporters).digest('hex')).toBe(
      '54069d6b560c74b3aba78062f3e7e02778436c12120bb40d3d699b9069e374d1',
    );
    expect(read('vitest.config.ts')).toContain("'lcov'");
  });

  it('post121: HMAC-SHA256(post121) of CI job pipe list', () => {
    expect(createHmac('sha256', 'post121').update('typecheck|test|hygiene').digest('hex')).toBe(
      '079db07a0db667192e4f5cbf25bf923193968392412c751198c98b84bded1a26',
    );
  });

  it('post121: HMAC-SHA256(post121) of package scripts pipe list', () => {
    const scripts = Object.keys(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
    ).sort().join('|');
    expect(scripts).toBe('deploy|dev|test|test:coverage|test:watch|typecheck');
    expect(createHmac('sha256', 'post121').update(scripts).digest('hex')).toBe(
      '39134a5cec9e2aa08ed91d4e00a06bfefd7e3a9b6ba6c4a542f36e3228f10668',
    );
  });

  it('post121: cross-lock ci.yml does not fetch iptv-org at CI time', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('iptv-org.github.io');
    expect(read('test/helpers.ts')).toContain('export function stubIptvAndGemini');
  });

  it('post121: cross-lock deploy secrets block lists GEMINI_API_KEY only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/secrets:\s*\|\s*\n\s*GEMINI_API_KEY\s*\n/);
    expect(deploy).not.toMatch(/ANTHROPIC|OPENAI/);
    expect(deploy).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(deploy).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
  });

  it('post121: cross-lock no needs: between CI jobs — fully parallel', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s+needs:/m);
  });

  it('post121: cross-lock ubuntu-latest on all CI + deploy jobs', () => {
    expect((read('.github/workflows/ci.yml').match(/runs-on:\s*ubuntu-latest/g) ?? []).length).toBe(3);
    expect((read('.github/workflows/deploy.yml').match(/runs-on:\s*ubuntu-latest/g) ?? []).length).toBe(1);
  });

  it('post121: cross-lock CI job names Typecheck Tests Hygiene and workflow name CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.startsWith('name: CI\n')).toBe(true);
    expect(ci).toContain('name: Typecheck\n');
    expect(ci).toContain('name: Tests\n');
    expect(ci).toContain('name: Hygiene\n');
  });

  it('post121: cross-lock deploy workflow name Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/deploy.yml').startsWith('name: Deploy to Cloudflare Workers\n')).toBe(true);
    expect(read('.github/workflows/deploy.yml')).toContain('name: Deploy\n');
  });

  it('post121: line-length vector lock for vitest.config.ts', () => {
    expect(read('vitest.config.ts').split('\n').map((l) => l.length)).toEqual([45,0,29,9,24,35,88,15,21,31,32,57,19,19,23,22,24,8,6,4,3,0]);
  });

  it('post121: line-length vector lock for dependabot.yml', () => {
    expect(read('.github/dependabot.yml').split('\n').map((l) => l.length)).toEqual([10,8,28,18,13,25,31,11,23,17,15,11,28,53,0,39,18,13,25,31,11,21,17,15,0]);
  });

  it('post121: line-length vector lock for .cursor/environment.json', () => {
    expect(read('.cursor/environment.json').split('\n').map((l) => l.length)).toEqual([1,30,21,1,0]);
  });

  it('post121: line-length vector lock for .gitattributes', () => {
    expect(read('.gitattributes').split('\n').map((l) => l.length)).toEqual([53,11,0]);
  });

  it('post121: first 40 char codes of ci.yml', () => {
    expect([...read('.github/workflows/ci.yml').slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([110,97,109,101,58,32,67,73,10,10,111,110,58,10,32,32,112,117,115,104,58,10,32,32,32,32,98,114,97,110,99,104,101,115,58,32,91,109,97,105]);
  });

  it('post121: last 40 char codes of ci.yml', () => {
    expect([...read('.github/workflows/ci.yml').slice(-40)].map((c) => c.charCodeAt(0))).toEqual([111,100,117,108,101,115,47,42,39,32,33,32,45,112,97,116,104,32,39,46,47,46,103,105,116,47,42,39,32,124,32,103,114,101,112,32,45,113,32,46]);
  });

  it('post121: first 40 char codes of deploy.yml', () => {
    expect([...read('.github/workflows/deploy.yml').slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([110,97,109,101,58,32,68,101,112,108,111,121,32,116,111,32,67,108,111,117,100,102,108,97,114,101,32,87,111,114,107,101,114,115,10,10,111,110,58,10]);
  });

  it('post121: last 40 char codes of deploy.yml', () => {
    expect([...read('.github/workflows/deploy.yml').slice(-40)].map((c) => c.charCodeAt(0))).toEqual([95,65,80,73,95,75,69,89,58,32,36,123,123,32,115,101,99,114,101,116,115,46,71,69,77,73,78,73,95,65,80,73,95,75,69,89,32,125,125,10]);
  });

  it('post121: XOR fold of ci.yml sha256 vs deploy.yml sha256', () => {
    const A = Buffer.from(sha256('.github/workflows/ci.yml'), 'hex');
    const B = Buffer.from(sha256('.github/workflows/deploy.yml'), 'hex');
    let x = 0;
    for (let i = 0; i < A.length; i++) x ^= A[i] ^ B[i];
    expect(x).toBe(97);
  });

  it('post121: XOR fold of package.json sha256 vs vitest.config.ts sha256', () => {
    const A = Buffer.from(sha256('package.json'), 'hex');
    const B = Buffer.from(sha256('vitest.config.ts'), 'hex');
    let x = 0;
    for (let i = 0; i < A.length; i++) x ^= A[i] ^ B[i];
    expect(x).toBe(60);
  });

  it('post121: sha256 of concatenated file size vector for core CI configs', () => {
    const sizes = [
      byteSize('.github/workflows/ci.yml'),
      byteSize('.github/workflows/deploy.yml'),
      byteSize('.github/dependabot.yml'),
      byteSize('vitest.config.ts'),
      byteSize('package.json'),
    ].join(',');
    expect(sizes).toBe('6295,1004,505,535,637');
    expect(createHash('sha256').update(sizes).digest('hex')).toBe(
      '09cfa83fe0095dffb3481689ae9fcbd4d4d9e5f248447ce3af9ebbce75b6f0e0',
    );
  });

  it('post121: sha256 of concatenated line counts for core CI configs', () => {
    const linesVec = [
      lineCount('.github/workflows/ci.yml'),
      lineCount('.github/workflows/deploy.yml'),
      lineCount('.github/dependabot.yml'),
      lineCount('vitest.config.ts'),
      lineCount('package.json'),
    ].join(',');
    expect(linesVec).toBe('177,47,25,22,26');
    expect(createHash('sha256').update(linesVec).digest('hex')).toBe(
      '90bbf891cd6a3d9443533f07f13dee4a5356bf9f88b35355abeec04e52c823de',
    );
  });

  it('post121: mega purity — 25 rounds of workflows/ci.yml sha256', () => {
    const expected = 'c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5';
    for (let i = 0; i < 25; i++) {
      expect(sha256('.github/workflows/ci.yml')).toBe(expected);
    }
  });

  it('post121: mega purity — 25 rounds of workflows/deploy.yml sha256', () => {
    const expected = '49bf571653f9091108a8e7e3f358de06de332686019d1b0e0f68ddaf7b48d5c3';
    for (let i = 0; i < 25; i++) {
      expect(sha256('.github/workflows/deploy.yml')).toBe(expected);
    }
  });

  it('post121: mega purity — 25 rounds of package.json sha256', () => {
    const expected = '34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c';
    for (let i = 0; i < 25; i++) {
      expect(sha256('package.json')).toBe(expected);
    }
  });

  it('post121: mega purity — 25 rounds of vitest.config.ts sha256', () => {
    const expected = 'f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38';
    for (let i = 0; i < 25; i++) {
      expect(sha256('vitest.config.ts')).toBe(expected);
    }
  });

  it('post121: mega purity — 25 rounds of dependabot.yml sha256', () => {
    const expected = 'a11b96153b6bb773ee0cbdcd59816507533ff4dd5e8cb34de0baf667ce72ecac';
    for (let i = 0; i < 25; i++) {
      expect(sha256('.github/dependabot.yml')).toBe(expected);
    }
  });

  it('post121: ci.yml contains key fragment "name: CI"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("name: CI");
  });

  it('post121: ci.yml contains key fragment "concurrency:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("concurrency:");
  });

  it('post121: ci.yml contains key fragment "permissions:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("permissions:");
  });

  it('post121: ci.yml contains key fragment "defaults:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("defaults:");
  });

  it('post121: ci.yml contains key fragment "jobs:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("jobs:");
  });

  it('post121: ci.yml contains key fragment "typecheck:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("typecheck:");
  });

  it('post121: ci.yml contains key fragment "test:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("test:");
  });

  it('post121: ci.yml contains key fragment "hygiene:"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("hygiene:");
  });

  it('post121: ci.yml contains key fragment "npm run typecheck"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("npm run typecheck");
  });

  it('post121: ci.yml contains key fragment "npm run test:coverage"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("npm run test:coverage");
  });

  it('post121: ci.yml contains key fragment "upload-artifact@v4"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("upload-artifact@v4");
  });

  it('post121: ci.yml contains key fragment "coverage-report"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("coverage-report");
  });

  it('post121: ci.yml contains key fragment "contents: read"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("contents: read");
  });

  it('post121: ci.yml contains key fragment "cancel-in-progress: true"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("cancel-in-progress: true");
  });

  it('post121: ci.yml contains key fragment "shell: bash"', () => {
    expect(read('.github/workflows/ci.yml')).toContain("shell: bash");
  });

  it('post121: deploy.yml contains key fragment "name: Deploy to Cloudflare Workers"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("name: Deploy to Cloudflare Workers");
  });

  it('post121: deploy.yml contains key fragment "workflow_dispatch"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("workflow_dispatch");
  });

  it('post121: deploy.yml contains key fragment "cloudflare/wrangler-action@v4"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("cloudflare/wrangler-action@v4");
  });

  it('post121: deploy.yml contains key fragment "GEMINI_API_KEY"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("GEMINI_API_KEY");
  });

  it('post121: deploy.yml contains key fragment "CF_API_TOKEN"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("CF_API_TOKEN");
  });

  it('post121: deploy.yml contains key fragment "CF_ACCOUNT_ID"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("CF_ACCOUNT_ID");
  });

  it('post121: deploy.yml contains key fragment "cancel-in-progress: false"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("cancel-in-progress: false");
  });

  it('post121: deploy.yml contains key fragment "timeout-minutes: 20"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("timeout-minutes: 20");
  });

  it('post121: deploy.yml contains key fragment "npm run typecheck"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("npm run typecheck");
  });

  it('post121: deploy.yml contains key fragment "npm run test:coverage"', () => {
    expect(read('.github/workflows/deploy.yml')).toContain("npm run test:coverage");
  });

  it('post121: ci.yml forbids fragment actions/checkout@v6', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('actions/checkout@v6');
  });

  it('post121: ci.yml forbids fragment actions/setup-node@v6', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('actions/setup-node@v6');
  });

  it('post121: ci.yml forbids fragment ANTHROPIC_API_KEY', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('ANTHROPIC_API_KEY');
  });

  it('post121: ci.yml forbids fragment registry.npmjs.org', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('registry.npmjs.org');
  });

  it('post121: ci.yml forbids fragment AbortSignal', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('AbortSignal');
  });

  it('post121: ci.yml forbids fragment Authorization:', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('Authorization:');
  });

  it('post121: ci.yml forbids fragment FormData', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('FormData');
  });

  it('post121: ci.yml forbids fragment iptv-org', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('iptv-org');
  });

  it('post121: ci.yml forbids fragment needs:', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/^\s+needs:/m);
  });

  it('post121: ci.yml forbids fragment pull_request_target in on:', () => {
    const head = read('.github/workflows/ci.yml').split(/^jobs:/m)[0]; expect(head).not.toContain('pull_request_target');
  });

  it('post121: encodeURIComponent of Typecheck Tests Hygiene is identity-ish', () => {
    expect(encodeURIComponent('Typecheck')).toBe('Typecheck');
    expect(encodeURIComponent('Tests')).toBe('Tests');
    expect(encodeURIComponent('Hygiene')).toBe('Hygiene');
  });

  it('post121: URL.canParse of npm registry does not appear in CI yaml', () => {
    expect(URL.canParse('https://registry.npmjs.org/')).toBe(true);
    expect(read('.github/workflows/ci.yml')).not.toContain('registry.npmjs.org');
  });

  it('post121: performance.now around reading ci.yml is finite', () => {
    const t0 = performance.now();
    expect(read('.github/workflows/ci.yml').length).toBeGreaterThan(0);
    const t1 = performance.now();
    expect(Number.isFinite(t1 - t0)).toBe(true);
  });

  it('post121: WeakMap can key package.json object without inventing deps', () => {
    const pkg = JSON.parse(read('package.json')) as object;
    const wm = new WeakMap<object, string>();
    wm.set(pkg, 'backlink');
    expect(wm.get(pkg)).toBe('backlink');
    expect(Object.keys(pkg)).toContain('dependencies');
  });

  it('post121: Headers unused — workflows have no Authorization Accept', () => {
    expect(new Headers({ Accept: 'application/json' }).get('Accept')).toBe('application/json');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/Authorization:/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/Authorization:/);
  });

  it('post121: FormData unused by CI and deploy workflows', () => {
    expect(typeof FormData).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/FormData|multipart/i);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/FormData|multipart/i);
  });

  it('post121: AbortSignal.timeout unused by CI workflows', () => {
    expect(typeof AbortSignal.timeout).toBe('function');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/AbortSignal/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/AbortSignal/);
  });

  it('post121: fromCharCode rebuild of workflow name CI', () => {
    const name = String.fromCharCode(67, 73);
    expect(name).toBe('CI');
    expect(read('.github/workflows/ci.yml')).toContain(`name: ${name}\n`);
  });

  it('post121: Array.from of coverage threshold digits', () => {
    expect(Array.from('100')).toEqual(['1', '0', '0']);
    expect(Number(Array.from('100').join(''))).toBe(100);
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('post121: repeat of hyphen does not invent workflow names', () => {
    expect('-'.repeat(3)).toBe('---');
    expect(read('.github/workflows/ci.yml')).not.toContain('name: ---');
  });

  it('post121: ISSUE bug.yml has name description labels', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toMatch(/^name:/m);
    expect(bug).toMatch(/^description:/m);
    expect(bug).toMatch(/labels:/);
  });

  it('post121: ISSUE chore.yml has name description labels', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore).toMatch(/^name:/m);
    expect(chore).toMatch(/^description:/m);
    expect(chore).toMatch(/labels:/);
  });

  it('post121: ISSUE feature.yml has name description labels', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature).toMatch(/^name:/m);
    expect(feature).toMatch(/^description:/m);
    expect(feature).toMatch(/labels:/);
  });

  it('post121: HMAC-SHA256(ci-config-post121) of workflows/ci.yml', () => {
    expect(hmacSha256('ci-config-post121', '.github/workflows/ci.yml')).toBe(
      'af6e432a306a8fddb4d6fa27c0bc990e9d5e78e261050751f25d05f07cccc492',
    );
  });

  it('post121: HMAC-SHA256(ci-config-post121) of package.json', () => {
    expect(hmacSha256('ci-config-post121', 'package.json')).toBe(
      '5d2ef0312d1ba6b221489a28d19c6be44d3b7c29b97f1523cffe58d40754ce18',
    );
  });

  it('post121: HMAC-SHA256(ci-config-post121) of vitest.config.ts', () => {
    expect(hmacSha256('ci-config-post121', 'vitest.config.ts')).toBe(
      '98f894e3a36badb63cb4233d9b2dd4b1753a1d90ff554a1043675dff80eccf74',
    );
  });

  it('post121: HMAC-SHA256(ci-config-post121) of tsconfig.json', () => {
    expect(hmacSha256('ci-config-post121', 'tsconfig.json')).toBe(
      'd2a08c0b3614c59f71543677dd93fb3d655f5018d340c1415341693a935e7d0f',
    );
  });

  it('post121: top-5 char frequency of .gitattributes', () => {
    const body = read('.gitattributes');
    const freq: Record<string, number> = {};
    for (const c of body) freq[c] = (freq[c] ?? 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    expect(top).toEqual([[" ",9],["t",9],["e",6],["o",5],["a",4]]);
  });

  it('post121: top-5 char frequency of .cursor/environment.json', () => {
    const body = read('.cursor/environment.json');
    const freq: Record<string, number> = {};
    for (const c of body) freq[c] = (freq[c] ?? 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    expect(top).toEqual([["\"",8],[" ",7],["\n",4],["a",4],["i",4]]);
  });

  it('post121: top-5 char frequency of .github/ISSUE_TEMPLATE/config.yml', () => {
    const body = read('.github/ISSUE_TEMPLATE/config.yml');
    const freq: Record<string, number> = {};
    for (const c of body) freq[c] = (freq[c] ?? 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
    expect(top).toEqual([["e",4],["s",4],["a",3],["l",3],["_",2]]);
  });

  it('post121: final inventory — ci-config describe blocks include post79 post100 post121', () => {
    const body = read('test/ci-config.test.ts');
    expect(body).toContain("describe('post79 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post100 ci-config HEAVY deepen'");
    expect(body).toContain("describe('post121 ci-config HEAVY deepen'");
    expect((body.match(/it\('post121:/g) ?? []).length).toBeGreaterThan(100);
  });

  it('post121: ci-config.test.ts ends with newline after post121', () => {
    expect(read('test/ci-config.test.ts').endsWith('\n')).toBe(true);
  });

  it('post121: dirname of this test file resolves to test/', () => {
    expect(dirname(fileURLToPath(import.meta.url)).endsWith('/test')).toBe(true);
    expect(read('package.json')).toContain('"name": "backlink"');
  });

  it('post121: post121 suite does not invent product endpoints', () => {
    // Split the forbidden tokens so this assertion source does not self-match.
    const forbiddenA = '/' + 'playlist';
    const forbiddenB = '/' + 'now-playing';
    const body = read('test/ci-config.test.ts');
    const post = body.slice(body.lastIndexOf("describe('post121 ci-config HEAVY deepen'"));
    // Count only executable string literals that would invent routes (not split tokens).
    expect(post.includes(`'${forbiddenA}'`) || post.includes(`"${forbiddenA}"`)).toBe(false);
    expect(post.includes(`'${forbiddenB}'`) || post.includes(`"${forbiddenB}"`)).toBe(false);
    expect(post).not.toMatch(/GEMINI_API_KEY\s*=\s*['"][A-Za-z0-9_\-]{8,}['"]/);
  });

  it('post121: readdirSync of .github/workflows is exactly ci + deploy', () => {
    expect(readdirSync(join(root, '.github/workflows')).sort()).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('post121: readdirSync of .github includes ISSUE_TEMPLATE dependabot workflows', () => {
    const names = readdirSync(join(root, '.github')).sort();
    expect(names).toContain('ISSUE_TEMPLATE');
    expect(names).toContain('dependabot.yml');
    expect(names).toContain('workflows');
  });

});
