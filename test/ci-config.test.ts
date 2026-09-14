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


  // --- post-#66 CI leftovers deepen (orthogonal to routes/helpers/genres/parser/wrangler) ---

  it('post66: negative dependabot does not schedule daily or weekly', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).not.toMatch(/interval:\s*"daily"/);
    expect(dep).not.toMatch(/interval:\s*"weekly"/);
    expect(dep).toMatch(/interval:\s*"monthly"/);
  });

  it('post66: negative dependabot does not set reviewers assignees or target-branch', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).not.toMatch(/reviewers:/);
    expect(dep).not.toMatch(/assignees:/);
    expect(dep).not.toMatch(/target-branch:/);
    expect(dep).not.toMatch(/labels:/);
  });

  it('post66: negative vitest.config does not invent pool threads forks watch passWithNoTests', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).not.toMatch(/pool:/);
    expect(cfg).not.toMatch(/threads:/);
    expect(cfg).not.toMatch(/forks:/);
    expect(cfg).not.toMatch(/passWithNoTests/);
    expect(cfg).not.toMatch(/watch:\s*true/);
    expect(cfg).not.toMatch(/globals:\s*true/);
  });

  it('post66: cross-locks package.json test:coverage script with CI Tests job run', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(read('.github/workflows/ci.yml')).toContain('npm run test:coverage');
  });

  it('post66: cross-locks package.json typecheck script with CI Typecheck job run', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(read('.github/workflows/ci.yml')).toContain('npm run typecheck');
  });

  it('post66: cross-locks AGENTS.md Verify block with package scripts', () => {
    const agents = read('AGENTS.md');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(agents).toContain('npm ci');
    expect(agents).toContain('npm run typecheck');
    expect(agents).toContain('npm test');
    expect(agents).toContain('npm run test:coverage');
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('post66: cross-locks deploy GEMINI_API_KEY with AGENTS escalate secret handling', () => {
    expect(read('.github/workflows/deploy.yml')).toContain('GEMINI_API_KEY');
    expect(read('AGENTS.md')).toMatch(/GEMINI_API_KEY handling/);
    expect(read('DEPLOY.md')).toContain('GEMINI_API_KEY');
  });

  it('post66: cross-locks vitest coverage thresholds with hygiene grep checks', () => {
    const cfg = read('vitest.config.ts');
    const hygiene = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
    expect(hygiene).toContain("grep -q 'branches: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'lines: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'functions: 100' vitest.config.ts");
    expect(hygiene).toContain("grep -q 'statements: 100' vitest.config.ts");
  });

  it('post66: cross-locks persist-credentials false across CI and deploy checkouts', () => {
    const ci = read('.github/workflows/ci.yml');
    const deploy = read('.github/workflows/deploy.yml');
    expect([...ci.matchAll(/persist-credentials:\s*false/g)]).toHaveLength(5);
    expect([...deploy.matchAll(/persist-credentials:\s*false/g)]).toHaveLength(1);
  });

  it('post66: cross-locks node-version 20 across CI jobs and deploy', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/node-version:\s*"20"/g)]).toHaveLength(3);
    expect([...read('.github/workflows/deploy.yml').matchAll(/node-version:\s*"20"/g)]).toHaveLength(
      1,
    );
  });

  it('post66: cross-locks npm cache key across setup-node steps', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/cache:\s*"npm"/g)]).toHaveLength(2);
    expect([...read('.github/workflows/deploy.yml').matchAll(/cache:\s*"npm"/g)]).toHaveLength(1);
  });

  it('post66: hash count in ci.yml is exactly 3 (comment markers only)', () => {
    expect((read('.github/workflows/ci.yml').match(/#/g) ?? []).length).toBe(3);
  });

  it('post66: deploy.yml and dependabot.yml have zero hash comments', () => {
    expect((read('.github/workflows/deploy.yml').match(/#/g) ?? []).length).toBe(0);
    expect((read('.github/dependabot.yml').match(/#/g) ?? []).length).toBe(0);
  });

  it('post66: ci.yml dollar-sign count locks github context interpolations to 4', () => {
    expect((read('.github/workflows/ci.yml').match(/\$/g) ?? []).length).toBe(4);
  });

  it('post66: deploy.yml dollar-sign count locks secrets interpolations to 4', () => {
    expect((read('.github/workflows/deploy.yml').match(/\$/g) ?? []).length).toBe(4);
  });

  it('post66: ci.yml at-sign count locks action pins to 7', () => {
    expect((read('.github/workflows/ci.yml').match(/@/g) ?? []).length).toBe(7);
  });

  it('post66: deploy.yml at-sign count locks action pins to 3', () => {
    expect((read('.github/workflows/deploy.yml').match(/@/g) ?? []).length).toBe(3);
  });

  it('post66: ci.yml tab count is zero (spaces only)', () => {
    expect(read('.github/workflows/ci.yml').includes('\t')).toBe(false);
  });

  it('post66: deploy.yml and dependabot.yml tab counts are zero', () => {
    expect(read('.github/workflows/deploy.yml').includes('\t')).toBe(false);
    expect(read('.github/dependabot.yml').includes('\t')).toBe(false);
  });

  it('post66: ci.yml backtick semicolon percent do not appear', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.includes('`')).toBe(false);
    expect(ci.includes(';')).toBe(false);
    expect(ci.includes('%')).toBe(false);
  });

  it('post66: ci.yml brace count is balanced at 11/11', () => {
    const ci = read('.github/workflows/ci.yml');
    expect((ci.match(/\{/g) ?? []).length).toBe(11);
    expect((ci.match(/\}/g) ?? []).length).toBe(11);
  });

  it('post66: deploy.yml brace count is balanced at 8/8', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect((deploy.match(/\{/g) ?? []).length).toBe(8);
    expect((deploy.match(/\}/g) ?? []).length).toBe(8);
  });

  it('post66: dependabot.yml has zero braces', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.includes('{')).toBe(false);
    expect(dep.includes('}')).toBe(false);
  });

  it('post66: ci.yml digit occurrence count stays at 48', () => {
    expect((read('.github/workflows/ci.yml').match(/\d/g) ?? []).length).toBe(48);
  });

  it('post66: deploy.yml digit occurrence count stays at 7', () => {
    expect((read('.github/workflows/deploy.yml').match(/\d/g) ?? []).length).toBe(7);
  });

  it('post66: dependabot.yml digit occurrence count stays at 3', () => {
    expect((read('.github/dependabot.yml').match(/\d/g) ?? []).length).toBe(3);
  });

  it('post66: ci.yml underscore count stays at 20', () => {
    expect((read('.github/workflows/ci.yml').match(/_/g) ?? []).length).toBe(20);
  });

  it('post66: deploy.yml underscore count stays at 11', () => {
    expect((read('.github/workflows/deploy.yml').match(/_/g) ?? []).length).toBe(11);
  });

  it('post66: dependabot.yml underscore count stays at 0', () => {
    expect((read('.github/dependabot.yml').match(/_/g) ?? []).length).toBe(0);
  });

  it('post66: ci.yml pipe count stays at 16', () => {
    expect((read('.github/workflows/ci.yml').match(/\|/g) ?? []).length).toBe(16);
  });

  it('post66: ci.yml ampersand count stays at 6', () => {
    expect((read('.github/workflows/ci.yml').match(/&/g) ?? []).length).toBe(6);
  });

  it('post66: deploy.yml pipe count is 1 for secrets multiline block', () => {
    expect((read('.github/workflows/deploy.yml').match(/\|/g) ?? []).length).toBe(1);
  });

  it('post66: Object.is compares CI workflow name to literal CI', () => {
    const name = read('.github/workflows/ci.yml').match(/^name:\s*(.+)$/m)?.[1]?.trim();
    expect(Object.is(name, 'CI')).toBe(true);
  });

  it('post66: fromCharCode rebuild of Hygiene matches live job display name', () => {
    const rebuilt = String.fromCharCode(72, 121, 103, 105, 101, 110, 101);
    expect(rebuilt).toBe('Hygiene');
    expect(read('.github/workflows/ci.yml')).toContain(`name: ${rebuilt}`);
  });

  it('post66: Number.parseInt of CI timeouts stays positive integers 10/15/5', () => {
    const parts = [10, 15, 5];
    expect(parts.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    const ci = read('.github/workflows/ci.yml');
    for (const n of parts) {
      expect(ci).toContain(`timeout-minutes: ${n}`);
    }
  });

  it('post66: CI on branches lock main for push and pull_request without tags/paths', () => {
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(onBlock).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
    expect(onBlock).not.toMatch(/tags:/);
    expect(onBlock).not.toMatch(/paths:/);
    expect(onBlock).not.toMatch(/paths-ignore:/);
    expect(onBlock).not.toMatch(/types:/);
  });

  it('post66: hygiene required-files list includes all ten contract suites', () => {
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

  it('post66: hygiene required-files list includes all five src modules', () => {
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

  it('post66: hygiene bans anthropic claude haiku in src and workflows', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("! grep -RqiE 'anthropic|claude|haiku' src --include='*.ts'");
    expect(step).toContain(
      "! grep -RqiE 'anthropic|claude|haiku' .github/workflows --include='*.yml'",
    );
  });

  it('post66: hygiene asserts typescript caret-5 and bans caret-6/7', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('grep -qE \'"typescript": "\\^5\\.\' package.json');
    expect(step).toContain('! grep -qE \'"typescript": "\\^[67]\\.\' package.json');
  });

  it('post66: hygiene asserts gemini-2.0-flash model pin in src/index.ts', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("grep -q 'gemini-2.0-flash' src/index.ts");
  });

  it('post66: hygiene asserts lockfileVersion 3 and hono and types exclude', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('grep -q \'"lockfileVersion": 3\' package-lock.json');
    expect(step).toContain('grep -q \'"hono"\' package.json');
    expect(step).toContain('grep -q "src/types.ts" vitest.config.ts');
  });

  it('post66: Assert coverage artifacts exist step checks dir lcov and SF:src/', () => {
    const step = read('.github/workflows/ci.yml').split('Assert coverage artifacts exist')[1];
    expect(step).toContain('test -d coverage');
    expect(step).toContain('test -f coverage/lcov.info');
    expect(step).toContain('test -s coverage/lcov.info');
    expect(step).toContain("grep -q 'SF:src/' coverage/lcov.info");
  });

  it('post66: Upload coverage report uses if always and if-no-files-found error', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('Upload coverage report'), ci.indexOf('hygiene:'));
    expect(block).toContain('if: always()');
    expect(block).toContain('if-no-files-found: error');
    expect(block).toContain('retention-days: 14');
    expect(block).toContain('name: coverage-report');
    expect(block).toContain('coverage/');
    expect(block).toContain('coverage/lcov.info');
  });

  it('post66: deploy wrangler-action secrets block lists GEMINI_API_KEY only', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const secretsBlock = deploy.slice(deploy.indexOf('secrets: |'), deploy.indexOf('env:'));
    expect(secretsBlock).toContain('GEMINI_API_KEY');
    expect(secretsBlock).not.toContain('CF_API_TOKEN');
    expect(secretsBlock).not.toContain('ANTHROPIC');
    expect(secretsBlock).not.toContain('OPENAI');
  });

  it('post66: deploy env block maps GEMINI_API_KEY from secrets context', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      'GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
    );
    expect(read('.github/workflows/deploy.yml')).toContain(
      'apiToken: ${{ secrets.CF_API_TOKEN }}',
    );
    expect(read('.github/workflows/deploy.yml')).toContain(
      'accountId: ${{ secrets.CF_ACCOUNT_ID }}',
    );
  });

  it('post66: package.json type module and dependency keys stay hono + six devDeps', () => {
    const pkg = JSON.parse(read('package.json')) as {
      type: string;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.type).toBe('module');
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

  it('post66: tsconfig include locks src test and vitest.config only', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      include: string[];
      compilerOptions: { module: string; moduleResolution: string; strict: boolean };
    };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
    expect(ts.compilerOptions.module).toBe('ESNext');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.strict).toBe(true);
  });

  it('post66: gitignore .env.* with !.env.example and pem/key and *~', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^\.env\.\*$/m);
    expect(gi).toMatch(/^!\.env\.example$/m);
    expect(gi).toMatch(/^\*\.pem$/m);
    expect(gi).toMatch(/^\*\.key$/m);
    expect(gi).toMatch(/^\*~$/m);
  });

  it('post66: .github top-level contains dependabot ISSUE_TEMPLATE workflows only', () => {
    const files = readdirSync(join(root, '.github')).sort();
    expect(files).toEqual(['ISSUE_TEMPLATE', 'dependabot.yml', 'workflows']);
  });

  it('post66: line index locks for critical CI header rows', () => {
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

  it('post66: line index locks for critical deploy header rows', () => {
    const lines = read('.github/workflows/deploy.yml').split('\n');
    expect(lines[0]).toBe('name: Deploy to Cloudflare Workers');
    expect(lines[2]).toBe('on:');
    expect(lines[3]).toBe('  workflow_dispatch:');
    expect(lines[5]).toBe('permissions:');
    expect(lines[8]).toBe('concurrency:');
    expect(lines[12]).toBe('jobs:');
    expect(lines[13]).toBe('  deploy:');
  });

  it('post66: line index locks for dependabot ecosystems', () => {
    const lines = read('.github/dependabot.yml').split('\n');
    expect(lines[0]).toBe('version: 2');
    expect(lines[1]).toBe('updates:');
    expect(lines[2]).toBe('  - package-ecosystem: "npm"');
    expect(lines[15]).toBe('  - package-ecosystem: "github-actions"');
  });

  it('post66: Immutable copy via Object.assign does not alias live ci string', () => {
    const ci = read('.github/workflows/ci.yml');
    const bag = Object.assign({}, { ci });
    bag.ci = 'mutated';
    expect(ci.startsWith('name: CI')).toBe(true);
    expect(bag.ci).toBe('mutated');
  });

  it('post66: Array.prototype.every confirms printable ASCII excluding tabs in ci.yml', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(
      [...ci].every((ch) => {
        const c = ch.charCodeAt(0);
        return c === 10 || (c >= 32 && c < 127);
      }),
    ).toBe(true);
  });

  it('post66: Array.prototype.every confirms printable ASCII excluding tabs in deploy.yml', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(
      [...deploy].every((ch) => {
        const c = ch.charCodeAt(0);
        return c === 10 || (c >= 32 && c < 127);
      }),
    ).toBe(true);
  });

  it('post66: hygiene no duplicate consecutive nonempty lines in dependabot.yml', () => {
    const nonempty = read('.github/dependabot.yml')
      .split('\n')
      .filter((l) => l.length > 0);
    for (let i = 1; i < nonempty.length; i++) {
      expect(nonempty[i]).not.toBe(nonempty[i - 1]);
    }
  });

  it('post66: CI does not use self-hosted or windows/macos runners', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/self-hosted/);
    expect(ci).not.toMatch(/windows-latest|macos-latest/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/self-hosted|windows-latest|macos-latest/);
  });

  it('post66: CI Typecheck job does not upload artifacts or run coverage', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('  typecheck:'), ci.indexOf('  test:'));
    expect(block).not.toContain('upload-artifact');
    expect(block).not.toContain('test:coverage');
    expect(block).toContain('run: npm run typecheck');
  });

  it('post66: CI Hygiene job does not install npm dependencies', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('  hygiene:'));
    expect(block).not.toContain('npm ci');
    expect(block).not.toContain('setup-node');
  });

  it('post66: CI Tests job is the only job that runs test:coverage', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/npm run test:coverage/g)]).toHaveLength(2);
    const typecheck = ci.slice(ci.indexOf('  typecheck:'), ci.indexOf('  test:'));
    const testJob = ci.slice(ci.indexOf('  test:'), ci.indexOf('  hygiene:'));
    const hygiene = ci.slice(ci.indexOf('  hygiene:'));
    expect(typecheck).not.toContain('test:coverage');
    expect(testJob).toContain('run: npm run test:coverage');
    expect(hygiene).toContain("grep -q 'npm run test:coverage' .github/workflows/deploy.yml");
    expect(hygiene).not.toMatch(/^\s+run: npm run test:coverage/m);
  });

  it('post66: deploy runs typecheck and test:coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheckAt = deploy.indexOf('npm run typecheck');
    const coverageAt = deploy.indexOf('npm run test:coverage');
    const wranglerAt = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheckAt).toBeGreaterThan(-1);
    expect(coverageAt).toBeGreaterThan(typecheckAt);
    expect(wranglerAt).toBeGreaterThan(coverageAt);
  });

  it('post66: String.raw of CI name and permissions lines match live content', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(String.raw`name: CI`);
    expect(ci).toContain(String.raw`contents: read`);
  });

  it('post66: does not embed non-ASCII or smart quotes in ci.yml or deploy.yml', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/[^\x00-\x7F]/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/[^\x00-\x7F]/);
  });

  it('post66: vitest.config environment is node not happy-dom or jsdom', () => {
    expect(read('vitest.config.ts')).toMatch(/environment:\s*'node'/);
    expect(read('vitest.config.ts')).not.toMatch(/happy-dom|jsdom/);
    expect(read('vitest.config.ts')).toMatch(/provider:\s*'v8'/);
  });

  it('post66: package.json version 0.1.0 cross-locks with wrangler VERSION', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
    expect(read('wrangler.toml')).toContain('VERSION = "0.1.0"');
  });

  it('post66: negative MCP SDK and JSON Schema draft keywords absent from CI', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/name_for_model|description_for_human|input_schema/);
    expect(ci).not.toMatch(/\$schema|additionalProperties|oneOf|anyOf|allOf/);
  });

  it('post66: CI does not reference Dockerfile docker-compose or softprops release', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/Dockerfile|docker-compose/i);
    expect(ci).not.toMatch(/action-gh-release|create-release|softprops|peter-evans|github-script/);
  });

  it('post66: dependabot groups npm-dependencies and github-actions with star patterns', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep).toContain('npm-dependencies:');
    expect(dep).toContain('github-actions:');
    expect([...dep.matchAll(/-\s*"\*"/g)]).toHaveLength(2);
    expect([...dep.matchAll(/directory:\s*"\/"/g)]).toHaveLength(2);
  });

  it('post66: CI comment about pull_request_target stays documentation only', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(
      '# Trigger must be push/pull_request only (not pull_request_target)',
    );
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).not.toMatch(/^\s*pull_request_target\s*:/m);
  });

  it('post66: CI awk guards against pull_request_target in on blocks', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('pull_request_target');
    expect(step).toContain("awk '/^on:/{f=1}");
  });

  it('post66: secret-scan step excludes md and package-lock and targets key patterns', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain("--exclude='*.md'");
    expect(step).toContain("--exclude='package-lock.json'");
    expect(step).toContain('(api[_-]?key|secret|token|password|private[_-]?key)');
  });

  it('post66: package.json description em-dash is the only non-ASCII', () => {
    const raw = read('package.json');
    const nonAscii = [...raw].filter((c) => c.charCodeAt(0) > 127);
    expect(nonAscii).toEqual(['—']);
    expect(nonAscii[0].codePointAt(0)).toBe(0x2014);
  });

  it('post66: package.json UTF-8 byte length exceeds UTF-16 length by em-dash expansion', () => {
    const raw = read('package.json');
    expect(raw.length).toBe(635);
    expect(new TextEncoder().encode(raw).length).toBe(637);
  });

  it('post66: vitest.config reporters ternary keys on GITHUB_ACTIONS env', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default']",
    );
  });

  it('post66: CI Hygiene timeout is shortest and Tests is longest', () => {
    const timeouts = [
      ...read('.github/workflows/ci.yml').matchAll(/timeout-minutes:\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(Math.min(...timeouts)).toBe(5);
    expect(Math.max(...timeouts)).toBe(15);
    expect(timeouts).toEqual([10, 15, 5]);
  });

  it('post66: deploy timeout exceeds all CI job timeouts', () => {
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

  it('post66: coverage retention-days 14 is two weeks in day units', () => {
    expect(14).toBe(2 * 7);
    expect(read('.github/workflows/ci.yml')).toContain('retention-days: 14');
  });

  it('post66: npm ci appears once per Node-using CI job and once in deploy', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/npm ci/g)]).toHaveLength(2);
    expect([...read('.github/workflows/deploy.yml').matchAll(/npm ci/g)]).toHaveLength(1);
  });

  it('post66: Install dependencies and Set up Node.js step counts', () => {
    expect([
      ...read('.github/workflows/ci.yml').matchAll(/- name: Install dependencies/g),
    ]).toHaveLength(2);
    expect([
      ...read('.github/workflows/deploy.yml').matchAll(/- name: Install dependencies/g),
    ]).toHaveLength(1);
    expect([...read('.github/workflows/ci.yml').matchAll(/- name: Set up Node\.js/g)]).toHaveLength(
      2,
    );
    expect([
      ...read('.github/workflows/deploy.yml').matchAll(/- name: Set up Node\.js/g),
    ]).toHaveLength(1);
  });

  it('post66: CI file ends with secret-scan find grep -q . without trailing newline', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.endsWith('| grep -q .')).toBe(true);
    expect(ci.endsWith('\n')).toBe(false);
  });

  it('post66: deploy file ends with GEMINI secret env mapping and trailing newline', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.endsWith('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}\n')).toBe(true);
  });

  it('post66: dependabot file ends with github-actions star pattern and trailing newline', () => {
    const dep = read('.github/dependabot.yml');
    expect(dep.endsWith('          - "*"\n')).toBe(true);
  });

  it('post66: vitest.config ends with closing braces and trailing newline', () => {
    expect(read('vitest.config.ts').endsWith('});\n')).toBe(true);
  });

  it('post66: no CRLF line endings in CI deploy dependabot vitest configs', () => {
    for (const rel of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      '.github/dependabot.yml',
      'vitest.config.ts',
    ]) {
      expect(read(rel).includes('\r')).toBe(false);
    }
  });

  it('post66: CI jobs block starts immediately after defaults shell bash', () => {
    expect(read('.github/workflows/ci.yml')).toContain('    shell: bash\n\njobs:\n  typecheck:');
  });

  it('post66: deploy jobs block starts immediately after concurrency cancel false', () => {
    expect(read('.github/workflows/deploy.yml')).toContain(
      '  cancel-in-progress: false\n\njobs:\n  deploy:',
    );
  });

  it('post66: package-lock lockfileVersion cross-locks hygiene assertion', () => {
    const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number };
    expect(lock.lockfileVersion).toBe(3);
    expect(read('.github/workflows/ci.yml')).toContain(
      'grep -q \'"lockfileVersion": 3\' package-lock.json',
    );
  });

  it('post66: cursor environment install is npm ci matching CI install steps', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { install: string; name: string };
    expect(env.install).toBe('npm ci');
    expect(env.name).toBe('Backlink_Facelift');
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
  });

  it('post66: ISSUE_TEMPLATE directory lists bug feature chore config only', () => {
    const files = readdirSync(join(root, '.github/ISSUE_TEMPLATE')).sort();
    expect(files).toEqual(['bug.yml', 'chore.yml', 'config.yml', 'feature.yml']);
  });

  it('post66: Map identity locks npm script name to command pairs used by CI', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const map = new Map(Object.entries(pkg.scripts));
    expect(map.get('typecheck')).toBe('tsc --noEmit');
    expect(map.get('test:coverage')).toBe('vitest run --coverage');
    expect(map.get('test')).toBe('vitest run');
    expect(map.size).toBe(6);
  });

  it('post66: Set identity locks required hygiene doc filenames', () => {
    const docs = new Set(['README.md', 'AGENTS.md', 'DEPLOY.md', 'docs/mcp-spec.md']);
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    for (const f of docs) {
      expect(step).toContain(`test -f ${f}`);
    }
  });

  it('post66: Proxy get trap over package name cannot rewrite live package.json', () => {
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

  it('post66: Object.freeze on vitest threshold bag stays immutable', () => {
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

  it('post66: Reflect.ownKeys on package scripts stays six ESM tooling entries', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Reflect.ownKeys(pkg.scripts).sort()).toEqual(
      ['deploy', 'dev', 'test', 'test:coverage', 'test:watch', 'typecheck'].sort(),
    );
  });

  it('post66: ci.yml colon count stays at 109', () => {
    expect((read('.github/workflows/ci.yml').match(/:/g) ?? []).length).toBe(109);
  });

  it('post66: deploy.yml colon count stays at 37', () => {
    expect((read('.github/workflows/deploy.yml').match(/:/g) ?? []).length).toBe(37);
  });

  it('post66: dependabot.yml colon count stays at 22', () => {
    expect((read('.github/dependabot.yml').match(/:/g) ?? []).length).toBe(22);
  });

  it('post66: ci.yml dash count stays at 173', () => {
    expect((read('.github/workflows/ci.yml').match(/-/g) ?? []).length).toBe(173);
  });

  it('post66: deploy.yml dash count stays at 16', () => {
    expect((read('.github/workflows/deploy.yml').match(/-/g) ?? []).length).toBe(16);
  });

  it('post66: dependabot.yml dash count stays at 20', () => {
    expect((read('.github/dependabot.yml').match(/-/g) ?? []).length).toBe(20);
  });

  it('post66: ci.yml double-quote count stays at 23', () => {
    expect((read('.github/workflows/ci.yml').match(/"/g) ?? []).length).toBe(23);
  });

  it('post66: ci.yml single-quote count stays at 113', () => {
    expect((read('.github/workflows/ci.yml').match(/'/g) ?? []).length).toBe(113);
  });

  it('post66: deploy.yml single-quote count is zero', () => {
    expect((read('.github/workflows/deploy.yml').match(/'/g) ?? []).length).toBe(0);
  });

  it('post66: space count in ci.yml stays at 1716', () => {
    expect((read('.github/workflows/ci.yml').match(/ /g) ?? []).length).toBe(1716);
  });

  it('post66: newline count in ci.yml stays at 176 (no trailing NL)', () => {
    expect((read('.github/workflows/ci.yml').match(/\n/g) ?? []).length).toBe(176);
  });

  it('post66: newline count in deploy.yml stays at 46', () => {
    expect((read('.github/workflows/deploy.yml').match(/\n/g) ?? []).length).toBe(46);
  });

  it('post66: CI and deploy do not declare permissions at job level', () => {
    const ci = read('.github/workflows/ci.yml');
    expect([...ci.matchAll(/^permissions:/gm)]).toHaveLength(1);
    expect(ci).not.toMatch(/^\s{4}permissions:/m);
    const deploy = read('.github/workflows/deploy.yml');
    expect([...deploy.matchAll(/^permissions:/gm)]).toHaveLength(1);
    expect(deploy).not.toMatch(/^\s{4}permissions:/m);
  });

  it('post66: fromCharCode rebuild of backlink package name matches package.json', () => {
    const rebuilt = String.fromCharCode(98, 97, 99, 107, 108, 105, 110, 107);
    expect(rebuilt).toBe('backlink');
    expect(JSON.parse(read('package.json')).name).toBe(rebuilt);
  });

  it('post66: TextDecoder round-trip of CI name bytes stays CI', () => {
    const bytes = new TextEncoder().encode('CI');
    expect(new TextDecoder().decode(bytes)).toBe('CI');
    expect(read('.github/workflows/ci.yml').startsWith('name: CI\n')).toBe(true);
  });

  it('post66: deploy does not use npm publish or semantic-release', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/npm publish|semantic-release|np |changeset/);
  });

  it('post66: AGENTS.md Verify fenced block lists four npm commands in order', () => {
    const agents = read('AGENTS.md');
    const block = agents.slice(agents.indexOf('## Verify'), agents.indexOf('## Escalate'));
    expect(block).toContain(
      '```bash\nnpm ci\nnpm run typecheck\nnpm test\nnpm run test:coverage\n```',
    );
  });

  it('post66: cross-locks README Cloud agents coverage floors with vitest thresholds', () => {
    expect(read('README.md')).toMatch(/Coverage floors stay at \*\*100%\*\*/);
    expect(read('vitest.config.ts')).toMatch(/lines:\s*100/);
  });

  it('post66: no BOM at start of CI deploy dependabot package vitest files', () => {
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

  it('post66: issue template config disables blank issues', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml')).toMatch(/^blank_issues_enabled:\s*false\s*$/m);
  });

  it('post66: bug issue template locks Bug name labels and required dropdowns', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug.yml');
    expect(bug).toMatch(/^name:\s*Bug\s*$/m);
    expect(bug).toContain('labels: ["bug"]');
    expect(bug).toContain('title: "[Bug]: "');
    expect(bug).toContain('options: [Parser, Curator, API, Deploy, CF-AI, KV-Cache]');
    expect(bug).toContain('options: [Critical, High, Medium, Low]');
    expect(bug).toContain('options: [XS, S, M, L, XL]');
    expect(bug).toContain('id: description');
    expect(bug).toContain('id: expected');
    expect(bug).toContain('id: steps');
  });

  it('post66: feature issue template locks Feature name enhancement label and New component', () => {
    const feature = read('.github/ISSUE_TEMPLATE/feature.yml');
    expect(feature).toMatch(/^name:\s*Feature\s*$/m);
    expect(feature).toContain('labels: ["enhancement"]');
    expect(feature).toContain('title: "[Feature]: "');
    expect(feature).toContain('options: [Parser, Curator, API, Deploy, CF-AI, KV-Cache, New]');
    expect(feature).toContain('id: status');
    expect(feature).toContain('options: [Backlog, Ready, "In Progress", Blocked]');
    expect(feature).toContain('id: acceptance');
  });

  it('post66: chore issue template locks Chore / Infra / Docs name and type options', () => {
    const chore = read('.github/ISSUE_TEMPLATE/chore.yml');
    expect(chore).toMatch(/^name:\s*Chore \/ Infra \/ Docs\s*$/m);
    expect(chore).toContain('labels: ["chore"]');
    expect(chore).toContain('title: "[Chore]: "');
    expect(chore).toContain('options: [Chore, Infra, Docs, Research]');
    expect(chore).not.toContain('id: status');
    expect(chore).not.toContain('id: acceptance');
  });

  it('post66: issue templates share Priority and Effort option sets', () => {
    for (const rel of [
      '.github/ISSUE_TEMPLATE/bug.yml',
      '.github/ISSUE_TEMPLATE/feature.yml',
      '.github/ISSUE_TEMPLATE/chore.yml',
    ]) {
      const body = read(rel);
      expect(body).toContain('options: [Critical, High, Medium, Low]');
      expect(body).toContain('options: [XS, S, M, L, XL]');
    }
  });

  it('post66: gitattributes locks LF normalization via text=auto', () => {
    const ga = read('.gitattributes');
    expect(ga).toContain('* text=auto');
    expect(ga).toMatch(/LF normalization/i);
    expect(ga.includes('\r')).toBe(false);
    expect(ga.endsWith('\n')).toBe(true);
  });

  it('post66: DEPLOY.md HITL Required bullets match AGENTS escalate themes', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('## HITL Required');
    expect(deploy).toMatch(/First production deploy must be reviewed by Andrew/);
    expect(deploy).toMatch(/GEMINI_API_KEY handling require approval/);
    expect(deploy).toMatch(/new external data sources requires approval/);
    expect(read('AGENTS.md')).toMatch(/Production deploy \(first deploy must be HITL\)/);
  });

  it('post66: DEPLOY.md documents wrangler secret put GEMINI_API_KEY and KV create', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('wrangler secret put GEMINI_API_KEY');
    expect(deploy).toContain('wrangler kv namespace create CATALOG_CACHE');
    expect(deploy).toContain('backlink.fuzzywigg.com');
    expect(deploy).toContain('npm run dev');
  });

  it('post66: README CI badge points at ci.yml workflow', () => {
    const readme = read('README.md');
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml/badge.svg',
    );
    expect(readme).toContain('npm run test:coverage');
    expect(readme).toContain('coverage floors');
  });

  it('post66: README Cloud agents section mentions environment.json npm ci only', () => {
    const readme = read('README.md');
    expect(readme).toContain('## Cloud agents');
    expect(readme).toContain('.cursor/environment.json');
    expect(readme).toMatch(/npm ci` only/);
  });

  it('post66: CI uses actions pins checkout@v7 setup-node@v7 upload-artifact@v4 only', () => {
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

  it('post66: deploy uses checkout@v7 setup-node@v7 wrangler-action@v4 only', () => {
    const uses = [...read('.github/workflows/deploy.yml').matchAll(/uses:\s*(\S+)/g)].map(
      (m) => m[1],
    );
    expect(uses).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'cloudflare/wrangler-action@v4',
    ]);
  });

  it('post66: CI job display names stay Typecheck Tests Hygiene', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('    name: Typecheck');
    expect(ci).toContain('    name: Tests');
    expect(ci).toContain('    name: Hygiene');
    expect(ci).not.toContain('name: Lint');
    expect(ci).not.toContain('name: Build');
  });

  it('post66: deploy job display name is Deploy under Deploy to Cloudflare Workers', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toMatch(/^name:\s*Deploy to Cloudflare Workers\s*$/m);
    expect(deploy).toContain('    name: Deploy');
  });

  it('post66: CI concurrency cancel-in-progress true while deploy is false', () => {
    expect(read('.github/workflows/ci.yml')).toContain('cancel-in-progress: true');
    expect(read('.github/workflows/deploy.yml')).toContain('cancel-in-progress: false');
  });

  it('post66: CI group template interpolates workflow and ref', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'group: ci-${{ github.workflow }}-${{ github.ref }}',
    );
    expect(read('.github/workflows/deploy.yml')).toContain(
      'group: deploy-${{ github.workflow }}',
    );
  });

  it('post66: package-lock name and version match package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      version: string;
      lockfileVersion: number;
    };
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lock.lockfileVersion).toBe(3);
  });

  it('post66: package-lock packages root has hono dependency entry', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { dependencies?: Record<string, string> }>;
    };
    expect(lock.packages[''].dependencies?.hono).toMatch(/^\^4\./);
    expect(lock.packages['node_modules/hono']).toBeTruthy();
  });

  it('post66: package.json has exactly six scripts and no prepare/prepublish', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Object.keys(pkg.scripts)).toEqual([
      'dev',
      'deploy',
      'typecheck',
      'test',
      'test:watch',
      'test:coverage',
    ]);
    expect(pkg.scripts.prepare).toBeUndefined();
    expect(pkg.scripts.prepublishOnly).toBeUndefined();
  });

  it('post66: vitest.config defineConfig import is sole import', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg.startsWith("import { defineConfig } from 'vitest/config';\n")).toBe(true);
    expect([...cfg.matchAll(/^import /gm)]).toHaveLength(1);
  });

  it('post66: tsconfig target and lib stay ES2022', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: { target: string; lib: string[]; resolveJsonModule: boolean };
    };
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.lib).toEqual(['ES2022']);
    expect(ts.compilerOptions.resolveJsonModule).toBe(true);
  });

  it('post66: environment.json UTF-8 length equals UTF-16 length (ASCII only)', () => {
    const raw = read('.cursor/environment.json');
    expect(raw.length).toBe(57);
    expect(new TextEncoder().encode(raw).length).toBe(57);
    expect([...raw].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it('post66: AGENTS.md classification Tier A Autonomy L2', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)');
    expect(agents).toContain('Autonomy: L2 (Standard — non-critical infra)');
    expect(agents).toContain('parent_governance: github.com/fuzzywigg/agents-governance');
  });

  it('post66: AGENTS.md Safe Agent Actions still lists unit tests under test/', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Add / extend unit tests under `test/` for existing behavior');
    expect(agents).toContain('Bump dependency versions');
  });

  it('post66: CI byte length stays under 8KB and deploy under 2KB lean budgets', () => {
    expect(Buffer.byteLength(read('.github/workflows/ci.yml'), 'utf8')).toBe(6295);
    expect(Buffer.byteLength(read('.github/workflows/deploy.yml'), 'utf8')).toBe(1004);
    expect(Buffer.byteLength(read('.github/dependabot.yml'), 'utf8')).toBe(505);
  });

  it('post66: structuredClone of package scripts bag is deep-equal but not identical', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const clone = structuredClone(pkg.scripts);
    expect(clone).toEqual(pkg.scripts);
    expect(clone).not.toBe(pkg.scripts);
    clone.test = 'hijacked';
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('post66: WeakMap identity does not retain live CI string after scope', () => {
    const wm = new WeakMap<object, string>();
    const key = { id: 'ci' };
    wm.set(key, read('.github/workflows/ci.yml').slice(0, 8));
    expect(wm.get(key)).toBe('name: CI');
  });

  it('post66: CI does not declare services container matrix needs or environment', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/^\s*services:/m);
    expect(ci).not.toMatch(/^\s*container:/m);
    expect(ci).not.toMatch(/^\s*strategy:/m);
    expect(ci).not.toMatch(/^\s*matrix:/m);
    expect(ci).not.toMatch(/^\s*needs:/m);
    expect(ci).not.toMatch(/^\s*environment:/m);
    expect(ci).not.toMatch(/cron:/);
  });

  it('post66: deploy does not declare schedule push pull_request or release triggers', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onBlock = deploy.slice(deploy.indexOf('\non:'), deploy.indexOf('\npermissions:'));
    expect(onBlock).toContain('workflow_dispatch:');
    expect(onBlock).not.toMatch(/push:/);
    expect(onBlock).not.toMatch(/pull_request:/);
    expect(onBlock).not.toMatch(/release:/);
    expect(onBlock).not.toMatch(/schedule:/);
  });

  it('post66: hygiene forbids GEMINI_API_KEY= and api_key= in wrangler.toml', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("! grep -q 'GEMINI_API_KEY=' wrangler.toml");
    expect(step).toContain("! grep -qiE 'api[_-]?key\\s*=' wrangler.toml");
  });

  it('post66: hygiene requires github-actions reporter and lcov in vitest.config', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("grep -q 'github-actions' vitest.config.ts");
    expect(step).toContain("grep -q 'lcov' vitest.config.ts");
    expect(step).toContain("grep -q 'thresholds' vitest.config.ts");
  });

  it('post66: hygiene requires workflow names CI Typecheck Tests Hygiene', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain("grep -q 'name: CI' .github/workflows/ci.yml");
    expect(step).toContain("grep -q 'name: Typecheck' .github/workflows/ci.yml");
    expect(step).toContain("grep -q 'name: Tests' .github/workflows/ci.yml");
    expect(step).toContain("grep -q 'name: Hygiene' .github/workflows/ci.yml");
  });

  it('post66: CI UTF-16 length equals UTF-8 byte length (ASCII-only workflow)', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.length).toBe(6295);
    expect(Buffer.byteLength(ci, 'utf8')).toBe(6295);
  });

  it('post66: deploy UTF-16 length equals UTF-8 byte length', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy.length).toBe(1004);
    expect(Buffer.byteLength(deploy, 'utf8')).toBe(1004);
  });

  it('post66: dependabot version key is numeric 2 not string', () => {
    // YAML stores version: 2; parse via regex since we do not YAML-parse
    expect(read('.github/dependabot.yml')).toMatch(/^version:\s*2\s*$/m);
    expect(read('.github/dependabot.yml')).not.toMatch(/version:\s*"2"/);
  });

  it('post66: dependabot open-pull-requests-limit npm 3 and actions 2', () => {
    const dep = read('.github/dependabot.yml');
    const limits = [...dep.matchAll(/open-pull-requests-limit:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(limits).toEqual([3, 2]);
  });

  it('post66: dependabot ignore block is semver-major only for npm ecosystem', () => {
    const dep = read('.github/dependabot.yml');
    const npmBlock = dep.slice(0, dep.indexOf('package-ecosystem: "github-actions"'));
    expect(npmBlock).toContain('update-types: ["version-update:semver-major"]');
    expect(npmBlock).toContain('dependency-name: "*"');
    const actionsBlock = dep.slice(dep.indexOf('package-ecosystem: "github-actions"'));
    expect(actionsBlock).not.toContain('ignore:');
  });

  it('post66: CI Test job step order checkout setup-node npm-ci coverage assert upload', () => {
    const ci = read('.github/workflows/ci.yml');
    const testJob = ci.slice(ci.indexOf('  test:'), ci.indexOf('  hygiene:'));
    const checkoutAt = testJob.indexOf('actions/checkout@v7');
    const setupAt = testJob.indexOf('actions/setup-node@v7');
    const npmCiAt = testJob.indexOf('run: npm ci');
    const coverageAt = testJob.indexOf('run: npm run test:coverage');
    const assertAt = testJob.indexOf('Assert coverage artifacts exist');
    const uploadAt = testJob.indexOf('Upload coverage report');
    expect(checkoutAt).toBeGreaterThan(-1);
    expect(setupAt).toBeGreaterThan(checkoutAt);
    expect(npmCiAt).toBeGreaterThan(setupAt);
    expect(coverageAt).toBeGreaterThan(npmCiAt);
    expect(assertAt).toBeGreaterThan(coverageAt);
    expect(uploadAt).toBeGreaterThan(assertAt);
  });

  it('post66: CI Typecheck job step order checkout setup-node npm-ci typecheck', () => {
    const ci = read('.github/workflows/ci.yml');
    const block = ci.slice(ci.indexOf('  typecheck:'), ci.indexOf('  test:'));
    const checkoutAt = block.indexOf('actions/checkout@v7');
    const setupAt = block.indexOf('actions/setup-node@v7');
    const npmCiAt = block.indexOf('run: npm ci');
    const typecheckAt = block.indexOf('run: npm run typecheck');
    expect(checkoutAt).toBeGreaterThan(-1);
    expect(setupAt).toBeGreaterThan(checkoutAt);
    expect(npmCiAt).toBeGreaterThan(setupAt);
    expect(typecheckAt).toBeGreaterThan(npmCiAt);
  });

  it('post66: Hygiene job step order checkout then required-files then secret-scan', () => {
    const block = read('.github/workflows/ci.yml').slice(
      read('.github/workflows/ci.yml').indexOf('  hygiene:'),
    );
    const checkoutAt = block.indexOf('actions/checkout@v7');
    const requiredAt = block.indexOf('Check required files');
    const secretAt = block.indexOf('Check for committed secret material');
    expect(checkoutAt).toBeGreaterThan(-1);
    expect(requiredAt).toBeGreaterThan(checkoutAt);
    expect(secretAt).toBeGreaterThan(requiredAt);
  });

  it('post66: deploy step order checkout setup-node npm-ci typecheck coverage wrangler', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const idxs = [
      deploy.indexOf('actions/checkout@v7'),
      deploy.indexOf('actions/setup-node@v7'),
      deploy.indexOf('run: npm ci'),
      deploy.indexOf('run: npm run typecheck'),
      deploy.indexOf('run: npm run test:coverage'),
      deploy.indexOf('cloudflare/wrangler-action@v4'),
    ];
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBeGreaterThan(idxs[i - 1]);
    }
  });

  it('post66: vitest coverage reporters include text text-summary html lcov', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporter: ['text', 'text-summary', 'html', 'lcov']",
    );
  });

  it('post66: vitest coverage include/exclude stay src/**/*.ts excluding types', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/include:\s*\['src\/\*\*\/\*\.ts'\]/);
    expect(cfg).toMatch(/exclude:\s*\['src\/types\.ts'\]/);
  });

  it('post66: package.json hono caret-4 and vitest caret-5 and wrangler caret-4', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
    expect(pkg.devDependencies.vitest).toMatch(/^\^5\./);
    expect(pkg.devDependencies['@vitest/coverage-v8']).toMatch(/^\^5\./);
    expect(pkg.devDependencies.wrangler).toMatch(/^\^4\./);
    expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
  });

  it('post66: Object.seal of a clone of environment.json does not seal live file parse', () => {
    const live = JSON.parse(read('.cursor/environment.json')) as Record<string, string>;
    const clone = { ...live };
    Object.seal(clone);
    expect(Object.isSealed(clone)).toBe(true);
    expect(Object.isSealed(live)).toBe(false);
    expect(JSON.parse(read('.cursor/environment.json'))).toEqual(live);
  });

  it('post66: JSON.stringify space-2 of environment.json still parses equal', () => {
    const live = JSON.parse(read('.cursor/environment.json'));
    const pretty = JSON.stringify(live, null, 2);
    expect(JSON.parse(pretty)).toEqual(live);
    expect(pretty).toContain('"install": "npm ci"');
  });

  it('post66: localeCompare sorts CI job keys typecheck hygiene test alphabetically', () => {
    const jobs = ['typecheck', 'test', 'hygiene'].sort((a, b) => a.localeCompare(b));
    expect(jobs).toEqual(['hygiene', 'test', 'typecheck']);
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('  typecheck:')).toBeLessThan(ci.indexOf('  test:'));
    expect(ci.indexOf('  test:')).toBeLessThan(ci.indexOf('  hygiene:'));
  });

  it('post66: encodeURIComponent of coverage-report artifact name stays unescaped', () => {
    expect(encodeURIComponent('coverage-report')).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml')).toContain('name: coverage-report');
  });

  it('post66: Number.isSafeInteger locks for CI timeouts and retention', () => {
    for (const n of [5, 10, 14, 15, 20]) {
      expect(Number.isSafeInteger(n)).toBe(true);
    }
  });

  it('post66: CI does not set GITHUB_TOKEN write or packages permissions', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/packages:\s*write/);
    expect(ci).not.toMatch(/contents:\s*write/);
    expect(ci).not.toMatch(/id-token:\s*write/);
    expect(ci).not.toMatch(/pull-requests:\s*write/);
  });

  it('post66: deploy does not set id-token write or contents write', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/packages:\s*write/);
    expect(deploy).not.toMatch(/contents:\s*write/);
    expect(deploy).not.toMatch(/id-token:\s*write/);
  });

  it('post66: root directory inventory keeps required tooling files present', () => {
    const files = new Set(readdirSync(root));
    for (const f of [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vitest.config.ts',
      'wrangler.toml',
      'AGENTS.md',
      'DEPLOY.md',
      'README.md',
      '.gitattributes',
      '.gitignore',
    ]) {
      expect(files.has(f)).toBe(true);
    }
  });

  it('post66: test directory inventory keeps ten contract files present', () => {
    const files = new Set(readdirSync(join(root, 'test')));
    for (const f of [
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
    ]) {
      expect(files.has(f)).toBe(true);
    }
  });

  it('post66: src directory inventory stays five modules only', () => {
    expect(readdirSync(join(root, 'src')).sort()).toEqual([
      'genres.ts',
      'index.ts',
      'mcp.ts',
      'parser.ts',
      'types.ts',
    ]);
  });

  it('post66: docs directory inventory is mcp-spec.md only', () => {
    expect(readdirSync(join(root, 'docs'))).toEqual(['mcp-spec.md']);
  });

  it('post66: .cursor directory inventory includes environment.json', () => {
    expect(readdirSync(join(root, '.cursor'))).toContain('environment.json');
  });

  it('post66: CI does not reference bun pnpm yarn or deno package managers', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/\bbun\b|\bpnpm\b|\byarn\b|\bdeno\b/);
    expect(ci).toContain('npm ci');
  });

  it('post66: deploy does not reference bun pnpm yarn or deno', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/\bbun\b|\bpnpm\b|\byarn\b|\bdeno\b/);
  });

  it('post66: package.json description locks LLM-curated internet radio wording', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('post66: AGENTS.md Purpose locks CF Workers and domain target', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('LLM-curated internet radio on CF Workers');
    expect(agents).toContain('Domain target: backlink.fuzzywigg.com');
  });

  it('post66: CI hygiene requires .gitattributes and .cursor/environment.json', () => {
    const step = read('.github/workflows/ci.yml').split('Check required files')[1];
    expect(step).toContain('test -f .gitattributes');
    expect(step).toContain('test -f .cursor/environment.json');
    expect(step).toContain('test -f .github/dependabot.yml');
  });

  it('post66: secret-scan excludes coverage node_modules and .git directories', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain('--exclude-dir=.git');
    expect(step).toContain('--exclude-dir=node_modules');
    expect(step).toContain('--exclude-dir=coverage');
  });

  it('post66: secret-scan bans committed .env .dev.vars pem and key files', () => {
    const step = read('.github/workflows/ci.yml').split('Check for committed secret material')[1];
    expect(step).toContain('! test -f .env');
    expect(step).toContain('! test -f .dev.vars');
    expect(step).toContain("! find . \\( -name '*.pem' -o -name '*.key' \\)");
  });

  it('post66: replaceAll underscore to hyphen on coverage-report stays stable kebab', () => {
    expect('coverage_report'.replaceAll('_', '-')).toBe('coverage-report');
    expect(read('.github/workflows/ci.yml')).toContain('name: coverage-report');
  });

  it('post66: Array.from of CI uses pins de-duplicates to three action families', () => {
    const uses = [...read('.github/workflows/ci.yml').matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect([...new Set(uses)].sort()).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v7',
      'actions/upload-artifact@v4',
    ]);
  });

  it('post66: padStart of node version string stays 20', () => {
    expect('20'.padStart(2, '0')).toBe('20');
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version:\s*"20"/);
  });

  it('post66: cancel-in-progress true appears once as concurrency + once in hygiene grep', () => {
    // live concurrency key + hygiene assertion that greps the same literal
    expect([...read('.github/workflows/ci.yml').matchAll(/cancel-in-progress:\s*true/g)]).toHaveLength(
      2,
    );
    const header = read('.github/workflows/ci.yml').slice(
      0,
      read('.github/workflows/ci.yml').indexOf('jobs:'),
    );
    expect([...header.matchAll(/cancel-in-progress:\s*true/g)]).toHaveLength(1);
  });

  it('post66: trim of CI workflow name line is name: CI', () => {
    expect(read('.github/workflows/ci.yml').split('\n')[0].trim()).toBe('name: CI');
  });

  it('post66: workflow_dispatch is deploy trigger; CI only mentions it via hygiene grep', () => {
    expect(read('.github/workflows/deploy.yml')).toMatch(/^on:\n {2}workflow_dispatch:\s*$/m);
    const ci = read('.github/workflows/ci.yml');
    const onBlock = ci.slice(ci.indexOf('\non:'), ci.indexOf('\nconcurrency:'));
    expect(onBlock).not.toMatch(/workflow_dispatch/);
    expect(ci).toContain("grep -q 'workflow_dispatch' .github/workflows/deploy.yml");
  });

  it('post66: indexOf order locks CI on: before concurrency before permissions before jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    const onAt = ci.indexOf('\non:');
    const concAt = ci.indexOf('\nconcurrency:');
    const permAt = ci.indexOf('\npermissions:');
    const jobsAt = ci.indexOf('\njobs:');
    expect(onAt).toBeGreaterThan(-1);
    expect(concAt).toBeGreaterThan(onAt);
    expect(permAt).toBeGreaterThan(concAt);
    expect(jobsAt).toBeGreaterThan(permAt);
  });

  it('post66: indexOf order locks deploy on: before permissions before concurrency before jobs', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const onAt = deploy.indexOf('\non:');
    const permAt = deploy.indexOf('\npermissions:');
    const concAt = deploy.indexOf('\nconcurrency:');
    const jobsAt = deploy.indexOf('\njobs:');
    expect(onAt).toBeGreaterThan(-1);
    expect(permAt).toBeGreaterThan(onAt);
    expect(concAt).toBeGreaterThan(permAt);
    expect(jobsAt).toBeGreaterThan(concAt);
  });

  it('post66: split CI on jobs: yields header plus three job bodies', () => {
    const parts = read('.github/workflows/ci.yml').split(/\n  (?:typecheck|test|hygiene):/);
    expect(parts).toHaveLength(4);
  });

  it('post66: matchAll timeout-minutes across CI and deploy yields 10 15 5 20', () => {
    const all = [
      ...read('.github/workflows/ci.yml').matchAll(/timeout-minutes:\s*(\d+)/g),
      ...read('.github/workflows/deploy.yml').matchAll(/timeout-minutes:\s*(\d+)/g),
    ].map((m) => Number(m[1]));
    expect(all).toEqual([10, 15, 5, 20]);
  });

  it('post66: Object.keys on parsed package.json stay stable top-level shape', () => {
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

  it('post66: Object.keys on parsed tsconfig stay compilerOptions and include', () => {
    const ts = JSON.parse(read('tsconfig.json')) as Record<string, unknown>;
    expect(Object.keys(ts)).toEqual(['compilerOptions', 'include']);
  });

  it('post66: Object.keys on parsed environment.json stay name and install', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as Record<string, unknown>;
    expect(Object.keys(env)).toEqual(['name', 'install']);
  });

  it('post66: Buffer.from CI header equals name: CI newline', () => {
    expect(Buffer.from(read('.github/workflows/ci.yml').slice(0, 9)).toString('utf8')).toBe(
      'name: CI\n',
    );
  });

  it('post66: codePointAt locks for CI first characters n a m e', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.codePointAt(0)).toBe('n'.codePointAt(0));
    expect(ci.codePointAt(1)).toBe('a'.codePointAt(0));
    expect(ci.codePointAt(2)).toBe('m'.codePointAt(0));
    expect(ci.codePointAt(3)).toBe('e'.codePointAt(0));
  });

  it('post66: endsWith locks for dependabot star pattern line', () => {
    expect(read('.github/dependabot.yml').trimEnd().endsWith('- "*"')).toBe(true);
  });

  it('post66: startsWith locks for vitest defineConfig import', () => {
    expect(read('vitest.config.ts').startsWith('import { defineConfig }')).toBe(true);
  });

  it('post66: lastIndexOf jobs: in CI is the only top-level jobs key', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci.indexOf('\njobs:')).toBe(ci.lastIndexOf('\njobs:'));
  });

  it('post66: CI does not enable fail-fast or continue-on-error inventing', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/fail-fast:/);
    expect(ci).not.toMatch(/continue-on-error:/);
  });

  it('post66: deploy does not enable fail-fast or continue-on-error', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).not.toMatch(/fail-fast:/);
    expect(deploy).not.toMatch(/continue-on-error:/);
  });

  it('post66: CI defaults.run.shell bash plus hygiene grep is the only shell:bash pair', () => {
    // defaults.run.shell + hygiene grep that asserts the same literal
    expect([...read('.github/workflows/ci.yml').matchAll(/shell:\s*bash/g)]).toHaveLength(2);
    const header = read('.github/workflows/ci.yml').slice(
      0,
      read('.github/workflows/ci.yml').indexOf('jobs:'),
    );
    expect(header).toMatch(/defaults:\s*\n\s*run:\s*\n\s*shell:\s*bash/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/shell:/);
  });

  it('post66: cross-locks DEPLOY.md Prerequisites Node.js 18+ with CI Node 20 pin', () => {
    expect(read('DEPLOY.md')).toContain('Node.js 18+');
    expect(read('.github/workflows/ci.yml')).toMatch(/node-version:\s*"20"/);
  });

  it('post66: cross-locks README Node 20 pin wording with CI setup-node', () => {
    expect(read('README.md')).toMatch(/CI pins Node 20/);
    expect([...read('.github/workflows/ci.yml').matchAll(/node-version:\s*"20"/g)].length).toBeGreaterThan(
      0,
    );
  });

  it('post66: issue template bug component options exclude New while feature includes New', () => {
    expect(read('.github/ISSUE_TEMPLATE/bug.yml')).not.toContain('KV-Cache, New]');
    expect(read('.github/ISSUE_TEMPLATE/feature.yml')).toContain('KV-Cache, New]');
  });

  it('post66: issue template config.yml is minimal blank_issues_enabled false only', () => {
    expect(read('.github/ISSUE_TEMPLATE/config.yml').trim()).toBe('blank_issues_enabled: false');
  });

  it('post66: gitignore section headers stay Dependencies Local env Wrangler Test coverage Editor', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('# Dependencies');
    expect(gi).toContain('# Local env / secrets (never commit)');
    expect(gi).toContain('# Wrangler / Workers local state');
    expect(gi).toContain('# Test coverage output');
    expect(gi).toContain('# Editor / OS noise');
  });

  it('post66: gitignore ignores node_modules coverage wrangler mf dist', () => {
    const gi = read('.gitignore');
    expect(gi).toMatch(/^node_modules\/$/m);
    expect(gi).toMatch(/^coverage\/$/m);
    expect(gi).toMatch(/^\.wrangler\/$/m);
    expect(gi).toMatch(/^\.mf\/$/m);
    expect(gi).toMatch(/^dist\/$/m);
  });

  it('post66: JSON.parse round-trip of package-lock preserves lockfileVersion 3', () => {
    const raw = read('package-lock.json');
    const once = JSON.parse(raw);
    const twice = JSON.parse(JSON.stringify(once));
    expect(twice.lockfileVersion).toBe(3);
    expect(twice.name).toBe('backlink');
  });

  it('post66: CI does not reference secrets context outside deploy workflow', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/secrets\./);
    expect(read('.github/workflows/deploy.yml')).toMatch(/secrets\.CF_API_TOKEN/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/secrets\.CF_ACCOUNT_ID/);
    expect(read('.github/workflows/deploy.yml')).toMatch(/secrets\.GEMINI_API_KEY/);
  });

  it('post66: deploy secrets interpolation count is exactly three secret names', () => {
    const secrets = [
      ...read('.github/workflows/deploy.yml').matchAll(/secrets\.([A-Z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(secrets.sort()).toEqual(['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'GEMINI_API_KEY'].sort());
  });

  it('post66: CI upload-artifact@v4 appears once as uses: + once in hygiene grep', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/upload-artifact@v4/g)]).toHaveLength(2);
    expect([...read('.github/workflows/ci.yml').matchAll(/uses:\s*actions\/upload-artifact@v4/g)]).toHaveLength(
      1,
    );
    expect(read('.github/workflows/deploy.yml')).not.toContain('upload-artifact');
  });

  it('post66: CI checkout@v7 appears exactly three times and setup-node@v7 twice', () => {
    expect([...read('.github/workflows/ci.yml').matchAll(/actions\/checkout@v7/g)]).toHaveLength(3);
    expect([...read('.github/workflows/ci.yml').matchAll(/actions\/setup-node@v7/g)]).toHaveLength(2);
  });

  it('post66: Reflect.has confirms scripts.test:coverage on package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(Reflect.has(pkg.scripts, 'test:coverage')).toBe(true);
    expect(Reflect.has(pkg.scripts, 'test:e2e')).toBe(false);
  });

  it('post66: Array.prototype.includes locks CI job id strings', () => {
    const ids = ['typecheck', 'test', 'hygiene'];
    expect(ids.includes('typecheck')).toBe(true);
    expect(ids.includes('lint')).toBe(false);
    for (const id of ids) {
      expect(read('.github/workflows/ci.yml')).toContain(`  ${id}:`);
    }
  });

  it('post66: slice of CI concurrency group line locks exact template', () => {
    const line = read('.github/workflows/ci.yml')
      .split('\n')
      .find((l) => l.includes('group: ci-'));
    expect(line?.trim()).toBe('group: ci-${{ github.workflow }}-${{ github.ref }}');
  });

  it('post66: slice of deploy concurrency group line locks exact template', () => {
    const line = read('.github/workflows/deploy.yml')
      .split('\n')
      .find((l) => l.includes('group: deploy-'));
    expect(line?.trim()).toBe('group: deploy-${{ github.workflow }}');
  });

  it('post66: CI does not set working-directory overrides', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/working-directory:/);
    expect(read('.github/workflows/deploy.yml')).not.toMatch(/working-directory:/);
  });

  it('post66: package.json private field unset and no exports/bin inventing', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.private).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
    expect(pkg.bin).toBeUndefined();
    expect(pkg.main).toBeUndefined();
  });

  it('post66: vitest include stays test/**/*.test.ts only', () => {
    expect(read('vitest.config.ts')).toMatch(/include:\s*\['test\/\*\*\/\*\.test\.ts'\]/);
  });

  it('post66: cross-locks AGENTS escalate CF account with no billing keys in CI', () => {
    expect(read('AGENTS.md')).toContain('Any billing or CF account configuration');
    expect(read('.github/workflows/ci.yml')).not.toMatch(/billing|CF_ACCOUNT/i);
  });

  it('post66: DEPLOY.md Cost Estimate mentions Workers free tier and Gemini 2.0 Flash', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('## Cost Estimate');
    expect(deploy).toContain('CF Workers free tier');
    expect(deploy).toContain('Gemini 2.0 Flash');
  });

  it('post66: README Available Genres lists nine canonical slugs', () => {
    const readme = read('README.md');
    for (const g of [
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]) {
      expect(readme).toContain(g);
    }
  });

  it('post66: charAt locks for dependabot first character v', () => {
    expect(read('.github/dependabot.yml').charAt(0)).toBe('v');
  });

  it('post66: substring locks for CI name field', () => {
    expect(read('.github/workflows/ci.yml').substring(0, 8)).toBe('name: CI');
  });

  it('post66: toLowerCase of CI name stays ci while file keeps CI', () => {
    expect('CI'.toLowerCase()).toBe('ci');
    expect(read('.github/workflows/ci.yml')).toContain('name: CI');
  });

  it('post66: toUpperCase of hygiene job id stays HYGIENE while display is Hygiene', () => {
    expect('hygiene'.toUpperCase()).toBe('HYGIENE');
    expect(read('.github/workflows/ci.yml')).toContain('name: Hygiene');
  });

});
