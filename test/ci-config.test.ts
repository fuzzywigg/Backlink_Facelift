import { readFileSync } from 'node:fs';
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
      'test/helpers.ts',
    ];
    for (const rel of files) {
      expect(read(rel).length).toBeGreaterThan(0);
    }
  });
});
