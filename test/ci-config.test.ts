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

  // --- HEAVY burn (post-#54): deepen CI / package contract coverage ---

  it('locks package.json scripts keys exactly in documented order', () => {
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

  it('locks package.json scripts values exactly', () => {
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

  it('locks package.json dependencies to only hono', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  });

  it('locks package.json devDependencies keys exactly', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
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

  it('locks package.json name version description type fields', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.name).toBe('backlink');
    expect(pkg.version).toBe('0.1.0');
    expect(pkg.type).toBe('module');
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
    expect(pkg.private).toBeUndefined();
    expect(pkg.engines).toBeUndefined();
  });

  it('locks CI Typecheck named steps in order after checkout', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Typecheck'), ci.indexOf('name: Tests'));
    const names = [...block.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual(['Set up Node.js', 'Install dependencies', 'Typecheck']);
  });

  it('locks CI Tests named steps in order after checkout', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Tests'), ci.indexOf('name: Hygiene'));
    const names = [...block.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Unit / integration tests with coverage',
      'Assert coverage artifacts exist',
      'Upload coverage report',
    ]);
  });

  it('locks CI Hygiene named steps in order after checkout', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Hygiene'));
    const names = [...block.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual(['Check required files', 'Check for committed secret material']);
  });

  it('locks deploy named steps in order after checkout', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const names = [...deploy.matchAll(/^\s+- name: (.+)$/gm)].map((m) => m[1]);
    expect(names).toEqual([
      'Set up Node.js',
      'Install dependencies',
      'Typecheck',
      'Unit / integration tests with coverage',
      'Deploy to Cloudflare Workers',
    ]);
  });

  it('locks CI job ids exactly typecheck test hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    const jobs = [...ci.matchAll(/^  ([a-z_]+):\n    (?:name:|runs-on:)/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['typecheck', 'test', 'hygiene']);
  });

  it('locks deploy workflow job id to deploy only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const jobs = [...deploy.matchAll(/^  ([a-z_]+):\n    runs-on:/gm)].map((m) => m[1]);
    expect(jobs).toEqual(['deploy']);
  });

  it('locks CI Typecheck uses checkout@v7 then setup-node@v7 only', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Typecheck'), ci.indexOf('name: Tests'));
    const uses = [...block.matchAll(/^\s+-?\s*uses:\s*(.+)$/gm)].map((m) => m[1]);
    expect(uses).toEqual(['actions/checkout@v7', 'actions/setup-node@v7']);
  });

  it('locks CI Tests uses checkout setup-node upload-artifact only', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Tests'), ci.indexOf('name: Hygiene'));
    const uses = [...block.matchAll(/^\s+-?\s*uses:\s*(.+)$/gm)].map((m) => m[1]);
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/upload-artifact@v4',
    ]);
  });

  it('locks CI Hygiene uses checkout@v7 only (no npm setup step)', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Hygiene'));
    const uses = [...block.matchAll(/^\s+-?\s*uses:\s*(.+)$/gm)].map((m) => m[1]);
    expect(uses).toEqual(['actions/checkout@v7']);
    expect(block).not.toMatch(/uses:\s*actions\/setup-node/);
    expect(block).not.toMatch(/run:\s*npm ci/);
    expect(block).not.toMatch(/run:\s*npm run/);
  });

  it('locks deploy uses checkout setup-node wrangler-action only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const uses = [...deploy.matchAll(/^\s+-?\s*uses:\s*(.+)$/gm)].map((m) => m[1]);
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'cloudflare/wrangler-action@v4',
    ]);
  });

  it('locks CI on: push and pull_request both targeting main only', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).toContain('push:');
    expect(onBlock).toContain('pull_request:');
    expect(onBlock).toMatch(/branches:\s*\[main\]/g);
    expect((onBlock.match(/branches:\s*\[main\]/g) ?? []).length).toBe(2);
    expect(onBlock).not.toMatch(/branches:\s*\[.*\*.*\]/);
    expect(onBlock).not.toContain('tags:');
    expect(onBlock).not.toContain('schedule:');
  });

  it('locks deploy on: workflow_dispatch with no other triggers', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.slice(deploy.indexOf('\non:'), deploy.indexOf('\npermissions:'));
    expect(onBlock.trim()).toBe('on:\n  workflow_dispatch:');
  });

  it('locks CI concurrency cancel-in-progress true with exact group template', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
    expect(ci).toMatch(/concurrency:\s*\n\s*group: ci-\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}\s*\n\s*cancel-in-progress:\s*true/);
  });

  it('locks deploy concurrency cancel-in-progress false with exact group', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('group: deploy-${{ github.workflow }}');
    expect(deploy).toMatch(/cancel-in-progress:\s*false/);
  });

  it('locks CI defaults.run.shell to bash only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash\s*\n/);
    expect(ci).not.toMatch(/shell:\s*pwsh/);
    expect(ci).not.toMatch(/shell:\s*python/);
  });

  it('locks deploy workflow free of defaults shell override', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toContain('defaults:');
  });

  it('locks every CI and deploy job runs-on ubuntu-latest', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    const runners = [
      ...ci.matchAll(/runs-on:\s*(\S+)/g),
      ...deploy.matchAll(/runs-on:\s*(\S+)/g),
    ].map((m) => m[1]);
    expect(runners).toEqual(['ubuntu-latest', 'ubuntu-latest', 'ubuntu-latest', 'ubuntu-latest']);
  });

  it('locks CI Typecheck timeout-minutes 10 Tests 15 Hygiene 5', () => {
    const ci = read('.github/workflows/ci.yml');
    const typecheck = ci.slice(ci.indexOf('  typecheck:'), ci.indexOf('  test:'));
    const test = ci.slice(ci.indexOf('  test:'), ci.indexOf('  hygiene:'));
    const hygiene = ci.slice(ci.indexOf('  hygiene:'));
    expect(typecheck).toMatch(/timeout-minutes:\s*10\b/);
    expect(test).toMatch(/timeout-minutes:\s*15\b/);
    expect(hygiene).toMatch(/timeout-minutes:\s*5\b/);
  });

  it('locks deploy timeout-minutes 20 exactly once', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect((deploy.match(/timeout-minutes:\s*20/g) ?? []).length).toBe(1);
  });

  it('locks setup-node node-version 20 and cache npm on CI and deploy', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const body = read(rel);
      expect(body).toContain('node-version: "20"');
      expect(body).toContain('cache: "npm"');
      expect((body.match(/node-version:\s*"20"/g) ?? []).length).toBeGreaterThanOrEqual(
        rel.includes('ci.yml') ? 2 : 1,
      );
    }
  });

  it('locks CI Upload coverage report if: always and if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    const upload = ci.slice(ci.indexOf('Upload coverage report'));
    expect(upload).toMatch(/if:\s*always\(\)/);
    expect(upload).toContain('if-no-files-found: error');
    expect(upload).toContain('retention-days: 14');
    expect(upload).toContain('name: coverage-report');
    expect(upload).toContain('coverage/');
    expect(upload).toContain('coverage/lcov.info');
  });

  it('locks CI Assert coverage artifacts commands exactly', () => {
    const ci = read('.github/workflows/ci.yml');
    const assert = ci.slice(
      ci.indexOf('Assert coverage artifacts exist'),
      ci.indexOf('Upload coverage report'),
    );
    expect(assert).toContain('test -d coverage');
    expect(assert).toContain('test -f coverage/lcov.info');
    expect(assert).toContain('test -s coverage/lcov.info');
    expect(assert).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('locks deploy wrangler-action secrets block to GEMINI_API_KEY only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const step = deploy.slice(deploy.indexOf('cloudflare/wrangler-action@v4'));
    expect(step).toContain('apiToken: ${{ secrets.CF_API_TOKEN }}');
    expect(step).toContain('accountId: ${{ secrets.CF_ACCOUNT_ID }}');
    expect(step).toMatch(/secrets:\s*\|\s*\n\s*GEMINI_API_KEY\s*\n/);
    expect(step).toContain('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}');
    expect(step).not.toMatch(/ANTHROPIC|OPENAI|CLAUDE/i);
  });

  it('locks deploy Typecheck and coverage gates before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheck = deploy.indexOf('npm run typecheck');
    const coverage = deploy.indexOf('npm run test:coverage');
    const wrangler = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheck).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(typecheck);
    expect(wrangler).toBeGreaterThan(coverage);
  });

  it('locks vitest.config.ts coverage thresholds all at 100', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/lines:\s*100/);
    expect(vitest).toMatch(/functions:\s*100/);
    expect(vitest).toMatch(/branches:\s*100/);
    expect(vitest).toMatch(/statements:\s*100/);
  });

  it('locks vitest.config.ts include environment provider reporters', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toContain("environment: 'node'");
    expect(vitest).toContain("include: ['test/**/*.test.ts']");
    expect(vitest).toContain("provider: 'v8'");
    expect(vitest).toContain("include: ['src/**/*.ts']");
    expect(vitest).toContain("exclude: ['src/types.ts']");
    expect(vitest).toContain("'text'");
    expect(vitest).toContain("'text-summary'");
    expect(vitest).toContain("'html'");
    expect(vitest).toContain("'lcov'");
  });

  it('locks vitest github-actions reporter gated on GITHUB_ACTIONS', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toContain("process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default']");
  });

  it('locks tsconfig compilerOptions keys and values', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.lib).toEqual(['ES2022']);
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.resolveJsonModule).toBe(true);
    expect(ts.compilerOptions.skipLibCheck).toBe(true);
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('locks tsconfig to exactly those top-level keys', () => {
    const ts = JSON.parse(read('tsconfig.json')) as Record<string, unknown>;
    expect(Object.keys(ts).sort()).toEqual(['compilerOptions', 'include']);
  });

  it('locks .cursor/environment.json to name Backlink_Facelift and npm ci', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as {
      name: string;
      install: string;
    };
    expect(env).toEqual({ name: 'Backlink_Facelift', install: 'npm ci' });
  });

  it('locks .gitattributes exact two-line LF normalization', () => {
    expect(read('.gitattributes')).toBe(
      '# Auto detect text files and perform LF normalization\n* text=auto\n',
    );
  });

  it('locks .gitignore secret and coverage entries as line anchors', () => {
    const gi = read('.gitignore');
    for (const line of [
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
    ]) {
      expect(gi.split('\n')).toContain(line);
    }
  });

  it('locks dependabot ecosystems exactly npm then github-actions', () => {
    const dep = read('.github/dependabot.yml');
    const ecosystems = [...dep.matchAll(/package-ecosystem:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ecosystems).toEqual(['npm', 'github-actions']);
  });

  it('locks dependabot both directories to slash root', () => {
    const dep = read('.github/dependabot.yml');
    const dirs = [...dep.matchAll(/directory:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(dirs).toEqual(['/', '/']);
  });

  it('locks dependabot version 2 and monthly cadence only', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.startsWith('version: 2\n')).toBe(true);
    expect((dep.match(/interval:\s*"monthly"/g) ?? []).length).toBe(2);
    expect(dep).not.toMatch(/interval:\s*"(daily|weekly)"/);
  });

  it('locks ISSUE_TEMPLATE config blank_issues_enabled false only', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml').trim()).toBe('blank_issues_enabled: false');
  });

  it('locks bug template body field ids in order', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    const ids = [...bug.matchAll(/^\s+id:\s+(\S+)/gm)].map((m) => m[1]);
    expect(ids).toEqual(['component', 'priority', 'effort', 'description', 'expected', 'steps']);
  });

  it('locks feature template body field ids in order', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    const ids = [...feature.matchAll(/^\s+id:\s+(\S+)/gm)].map((m) => m[1]);
    expect(ids).toEqual([
      'component',
      'priority',
      'effort',
      'status',
      'description',
      'acceptance',
    ]);
  });

  it('locks chore template body field ids in order', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    const ids = [...chore.matchAll(/^\s+id:\s+(\S+)/gm)].map((m) => m[1]);
    expect(ids).toEqual(['type', 'priority', 'effort', 'description']);
  });

  it('locks bug feature chore template titles and labels', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toContain('title: "[Bug]: "');
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toContain('title: "[Feature]: "');
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toContain('title: "[Chore]: "');
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).toContain('labels: ["bug"]');
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toContain('labels: ["enhancement"]');
    expect(read('.github/ISSUE_TEMPLATE/chore.yml')).toContain('labels: ["chore"]');
  });

  it('locks hygiene required-files list includes every contract suite', () => {
    const ci = read('.github/workflows/ci.yml');
    const required = [
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
      'src/index.ts',
      'src/parser.ts',
      'src/genres.ts',
      'src/mcp.ts',
      'src/types.ts',
    ];
    for (const file of required) {
      expect(ci).toContain(`test -f ${file}`);
    }
  });

  it('locks hygiene vitest threshold greps for all four floors', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'thresholds' vitest.config.ts");
    expect(ci).toContain("grep -q 'branches: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'lines: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'functions: 100' vitest.config.ts");
    expect(ci).toContain("grep -q 'statements: 100' vitest.config.ts");
  });

  it('locks hygiene bans Anthropic leftovers in src and workflows', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(ci).toContain(
      "! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'",
    );
  });

  it('locks hygiene gemini-2.0-flash and typescript caret-5 pins', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
    expect(ci).toContain('grep -qE \'"typescript": "\\^5\\.\' package.json');
    expect(ci).toContain('! grep -qE \'"typescript": "\\^[67]\\.\' package.json');
  });

  it('locks hygiene deploy gates for typecheck coverage GEMINI and workflow_dispatch', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'workflow_dispatch' .github/workflows/deploy.yml");
    expect(ci).toContain("grep -q 'GEMINI_API_KEY' .github/workflows/deploy.yml");
    expect(ci).toContain("grep -q 'npm run typecheck' .github/workflows/deploy.yml");
    expect(ci).toContain("grep -q 'npm run test:coverage' .github/workflows/deploy.yml");
  });

  it('locks hygiene CI metadata greps for job names and artifact settings', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'name: Typecheck' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'name: Tests' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'name: Hygiene' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'name: CI' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'coverage-report' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'if: always()' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'upload-artifact@v4' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'if-no-files-found: error' .github/workflows/ci.yml");
    expect(ci).toContain("grep -q 'retention-days: 14' .github/workflows/ci.yml");
  });

  it('locks hygiene pull_request_target bans via awk on CI and deploy', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('pull_request_target');
    expect(ci).toContain(
      "! awk '/^on:/{f=1} f && /^[^[:space:]#]/{if($0 !~ /^on:/) exit} f' .github/workflows/ci.yml | grep -q 'pull_request_target'",
    );
    expect(ci).toContain(
      "! awk '/^on:/{f=1} f && /^[^[:space:]#]/{if($0 !~ /^on:/) exit} f' .github/workflows/deploy.yml | grep -q 'pull_request_target'",
    );
  });

  it('locks hygiene secret-scan exclude markdown and package-lock', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain("--exclude='*.md'");
    expect(step).toContain("--exclude='package-lock.json'");
  });

  it('locks package-lock name version and lockfileVersion 3', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      version: string;
      lockfileVersion: number;
    };
    expect(lock.name).toBe('backlink');
    expect(lock.version).toBe('0.1.0');
    expect(lock.lockfileVersion).toBe(3);
  });

  it('locks AGENTS.md Verify block scripts equal package.json scripts', () => {
    const agents = read('AGENTS.md');
    const verify = agents.slice(agents.indexOf('## Verify'), agents.indexOf('## Escalate'));
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(verify).toContain('npm ci');
    expect(verify).toContain('npm run typecheck');
    expect(verify).toContain('npm test');
    expect(verify).toContain('npm run test:coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('locks README Cloud agents section mentions typecheck and test:coverage', () => {
    const readme = read('README.md');
    expect(readme).toContain('npm run typecheck');
    expect(readme).toContain('npm run test:coverage');
    expect(readme).toContain('.github/workflows/ci.yml');
    expect(readme).toContain('.cursor/environment.json');
  });

  it('locks DEPLOY.md Local dev uses npm run dev on localhost:8787', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('npm run dev');
    expect(deploy).toContain('http://localhost:8787');
  });

  it('locks DEPLOY.md HITL bullets for first deploy GEMINI and external sources', () => {
    const deploy = read('DEPLOY.md');
    const hitl = deploy.slice(deploy.indexOf('## HITL Required'));
    expect(hitl).toMatch(/First production deploy/);
    expect(hitl).toMatch(/GEMINI_API_KEY/);
    expect(hitl).toMatch(/external data sources/);
  });

  it('locks AGENTS.md Classification Tier A Autonomy L2', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)');
    expect(agents).toContain('Autonomy: L2 (Standard — non-critical infra)');
  });

  it('locks CI permissions contents read before defaults', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('permissions:')).toBeLessThan(ci.indexOf('defaults:'));
    expect(ci.indexOf('defaults:')).toBeLessThan(ci.indexOf('jobs:'));
  });

  it('locks deploy permissions contents read before concurrency', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.indexOf('permissions:')).toBeLessThan(deploy.indexOf('concurrency:'));
    expect(deploy.indexOf('concurrency:')).toBeLessThan(deploy.indexOf('jobs:'));
  });

  it('locks CI workflow name CI and deploy workflow name Deploy to Cloudflare Workers', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/^name:\s*CI\s*$/m);
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /^name:\s*Deploy to Cloudflare Workers\s*$/m,
    );
  });

  it('locks CI job display names Typecheck Tests Hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('name: Typecheck');
    expect(ci).toContain('name: Tests');
    expect(ci).toContain('name: Hygiene');
  });

  it('locks deploy job display name Deploy', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('name: Deploy');
  });

  it('locks persist-credentials false adjacent to every checkout step', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const body = read(rel);
      const pairs = body.match(
        /uses:\s*actions\/checkout@v7\s*\n\s*with:\s*\n\s*persist-credentials:\s*false/g,
      ) ?? [];
      const checkouts = body.match(/^\s+- uses:\s*actions\/checkout@v7\s*$/gm) ?? [];
      expect(pairs.length).toBe(checkouts.length);
      expect(checkouts.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('locks CI and deploy free of working-directory overrides', () => {
    expect(read('.github/workflows/ci.yml')).not.toContain('working-directory:');
    expect(read('.github/workflows/deploy.yml')).not.toContain('working-directory:');
  });

  it('locks CI and deploy free of id-token write and packages write', () => {
    for (const rel of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
      const body = read(rel);
      expect(body).not.toMatch(/id-token:\s*write/);
      expect(body).not.toMatch(/packages:\s*write/);
      expect(body).not.toMatch(/contents:\s*write/);
    }
  });

  it('locks package-lock to include all package.json dependency names', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    for (const name of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]) {
      expect(lock.packages[`node_modules/${name}`]).toBeTruthy();
    }
  });

  it('locks vitest coverage include src and exclude types only', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/include:\s*\['src\/\*\*\/\*\.ts'\]/);
    expect(vitest).toMatch(/exclude:\s*\['src\/types\.ts'\]/);
  });

  it('locks hygiene cancel-in-progress true grep for CI concurrency', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'cancel-in-progress: true' .github/workflows/ci.yml");
  });

  it('locks hygiene contents read on deploy permissions', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'contents: read' .github/workflows/deploy.yml");
  });

  it('locks hygiene wrangler.toml secret bans', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(ci).toContain("! grep -qiE 'api[_-]?key\\s*=' wrangler.toml");
  });

  it('locks hygiene Assert coverage artifacts exist step name grep', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'Assert coverage artifacts exist' .github/workflows/ci.yml");
  });

  it('locks hygiene shell bash and node-version 20 greps', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'shell: bash' .github/workflows/ci.yml");
    expect(ci).toContain('grep -q \'node-version: "20"\' .github/workflows/ci.yml');
  });

  it('locks hygiene github-actions and lcov reporter greps in vitest', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain("grep -q 'github-actions' vitest.config.ts");
    expect(ci).toContain("grep -q 'lcov' vitest.config.ts");
    expect(ci).toContain('grep -q "src/types.ts" vitest.config.ts');
  });

  it('locks hygiene hono runtime dependency grep', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('grep -q \'"hono"\' package.json');
  });

  it('locks hygiene lockfileVersion 3 grep', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('grep -q \'"lockfileVersion": 3\' package-lock.json');
  });

  it('locks hygiene required docs and workflow files', () => {
    const ci = read('.github/workflows/ci.yml');
    for (const file of [
      'README.md',
      'AGENTS.md',
      'DEPLOY.md',
      'package.json',
      'package-lock.json',
      'wrangler.toml',
      '.gitattributes',
      '.cursor/environment.json',
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
      'tsconfig.json',
    ]) {
      expect(ci).toContain(`test -f ${file}`);
    }
    expect(ci).toContain('test -d test');
  });

  it('locks CI Typecheck Install dependencies step runs npm ci', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Typecheck'), ci.indexOf('name: Tests'));
    expect(block).toMatch(/- name: Install dependencies\n\s+run: npm ci/);
  });

  it('locks CI Tests Install dependencies step runs npm ci', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('name: Tests'), ci.indexOf('name: Hygiene'));
    expect(block).toMatch(/- name: Install dependencies\n\s+run: npm ci/);
  });

  it('locks deploy Install dependencies step runs npm ci', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/- name: Install dependencies\n\s+run: npm ci/);
  });

  it('locks CI free of softprops/action-gh-release and docker actions', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/softprops\/action-gh-release|docker\/|aws-actions\//);
  });

  it('locks deploy free of npm publish and gh release steps', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/npm publish|gh release|softprops\//);
  });

  it('locks package.json free of optionalDependencies peerDependencies and bundledDependencies', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.bundledDependencies).toBeUndefined();
  });

  it('locks vitest config defineConfig import from vitest/config', () => {
    expect(read('vitest.config.ts')).toContain("import { defineConfig } from 'vitest/config'");
    expect(read('vitest.config.ts')).toContain('export default defineConfig');
  });

  it('locks typescript caret major on 5.x and vitest on 5.x and wrangler on 4.x', () => {
    const pkg = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
    expect(pkg.devDependencies['@types/node']).toMatch(/^\^22\./);
  });

  it('locks CI concurrency group before permissions block', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('concurrency:')).toBeLessThan(ci.indexOf('permissions:'));
  });

  it('locks deploy concurrency after permissions before jobs', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.indexOf('permissions:')).toBeLessThan(deploy.indexOf('concurrency:'));
    expect(deploy.indexOf('concurrency:')).toBeLessThan(deploy.indexOf('jobs:'));
  });

  it('locks CI Test job coverage step name Unit / integration tests with coverage', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'Unit / integration tests with coverage',
    );
    expect(read('.github/workflows/deploy.yml')).toContain(
      'Unit / integration tests with coverage',
    );
  });

  it('locks CI and deploy Typecheck step names', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/- name: Typecheck\n\s+run: npm run typecheck/);
    expect(read('.github/workflows/deploy.yml')).toMatch(
      /- name: Typecheck\n\s+run: npm run typecheck/,
    );
  });

  it('locks ISSUE_TEMPLATE directory to exactly four yaml files', () => {
    const files = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
    expect(files).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('locks .github workflows directory to exactly ci.yml and deploy.yml', () => {
    const files = readdirSync(join(root, '.github/workflows')).sort();
    expect(files).toEqual(['ci.yml', 'deploy.yml']);
  });

  it('locks .github top-level to ISSUE_TEMPLATE dependabot and workflows', () => {
    const entries = readdirSync(join(root, '.github')).sort();
    expect(entries).toEqual(['ISSUE_TEMPLATE', 'dependabot.yml', 'workflows']);
  });

  it('locks test directory to helpers plus nine suites', () => {
    const files = readdirSync(join(root, 'test')).sort();
    expect(files).toEqual([
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

  it('locks src directory to five TypeScript modules', () => {
    const files = readdirSync(join(root, 'src')).sort();
    expect(files).toEqual(['genres.ts', 'index.ts', 'mcp.ts', 'parser.ts', 'types.ts']);
  });

  it('locks docs directory to mcp-spec.md only', () => {
    expect(readdirSync(join(root, 'docs'))).toEqual(['mcp-spec.md']);
  });

  it('locks .cursor directory to environment.json only', () => {
    expect(readdirSync(join(root, '.cursor'))).toEqual(['environment.json']);
  });

  it('cross-locks CI Node 20 pin with DEPLOY.md Node 18+ prerequisite', () => {
    expect(read('.github/workflows/ci.yml')).toContain('node-version: "20"');
    expect(read('DEPLOY.md')).toContain('Node.js 18+');
  });

  it('cross-locks package description with Worker root description literal', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(read('src/index.ts')).toContain(`description: '${pkg.description}'`);
  });

  it('cross-locks package version 0.1.0 with wrangler.toml VERSION var', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
    expect(read('wrangler.toml')).toContain('VERSION = "0.1.0"');
  });

  it('cross-locks AGENTS.md domain target with wrangler custom domain pattern', () => {
    expect(read('AGENTS.md')).toContain('backlink.fuzzywigg.com');
    expect(read('wrangler.toml')).toContain('pattern = "backlink.fuzzywigg.com"');
  });

  it('locks CI free of matrix strategy and fail-fast keys', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toContain('strategy:');
    expect(ci).not.toContain('matrix:');
    expect(ci).not.toContain('fail-fast:');
  });

  it('locks deploy free of matrix strategy and environment: keys', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toContain('strategy:');
    expect(deploy).not.toContain('matrix:');
    expect(deploy).not.toMatch(/^\s+environment:/m);
  });

  it('locks CI jobs independent with no needs: edges', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/^\s+needs:/m);
  });

  it('locks deploy single job with no needs: edges', () => {
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/^\s+needs:/m);
  });
});
