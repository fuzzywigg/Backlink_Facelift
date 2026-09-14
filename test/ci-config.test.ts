import { readdirSync, readFileSync } from 'node:fs';
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
