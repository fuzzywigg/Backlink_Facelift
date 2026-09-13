import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('source ↔ product contracts', () => {
  it('wires Gemini 2.0 Flash (not Anthropic) in the Worker', () => {
    const index = read('src/index.ts');
    expect(index).toContain('gemini-2.0-flash');
    expect(index).toContain('generativelanguage.googleapis.com');
    expect(index).toContain('GEMINI_API_KEY');
    expect(index).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('fetches iptv-org category M3Us from the documented CDN base', () => {
    const index = read('src/index.ts');
    expect(index).toContain('https://iptv-org.github.io/iptv/categories');
    expect(index).toMatch(/expirationTtl:\s*3600/);
  });

  it('keeps Env bindings aligned with wrangler.toml', () => {
    const types = read('src/types.ts');
    expect(types).toContain('CATALOG_CACHE: KVNamespace');
    // Optional at runtime — /curate returns 503 when GEMINI_API_KEY is unset (#8)
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(types).toMatch(/VERSION\?:\s*string/);
  });

  it('documents Gemini secret + HITL deploy constraints', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/wrangler secret put GEMINI_API_KEY/);
    expect(deploy).toMatch(/HITL/i);
    expect(deploy).not.toMatch(/ANTHROPIC_API_KEY/);
  });

  it('keeps Worker CORS open and routes registered in src/index.ts', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/app\.use\('\*',\s*cors\(\)\)/);
    expect(index).toMatch(/app\.get\('\/curate'/);
    expect(index).toMatch(/app\.get\('\/stations'/);
    expect(index).toMatch(/app\.get\('\/genres'/);
    expect(index).toMatch(/app\.get\('\/health'/);
    expect(index).toMatch(/app\.get\('\/'/);
  });

  it('gracefully degrades /curate with editorial null on Gemini failure', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/editorial:\s*null/);
    expect(index).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it('keeps Cloud Agent bootstrap as npm ci only', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as {
      name: string;
      install: string;
    };
    expect(env.name).toBe('Backlink_Facelift');
    expect(env.install).toBe('npm ci');
  });

  it('guards /curate when GEMINI_API_KEY is unset before catalog work', () => {
    const index = read('src/index.ts');
    const keyGuard = index.indexOf('if (!c.env.GEMINI_API_KEY)');
    const fetchStationsCall = index.indexOf('stations = await fetchStations(genre', keyGuard);
    expect(keyGuard).toBeGreaterThan(-1);
    expect(fetchStationsCall).toBeGreaterThan(keyGuard);
    expect(index).toContain("error: 'Curation service unavailable'");
  });

  it('limits Gemini station context to the first 50 entries', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/stations\s*\n\s*\.slice\(0,\s*50\)/);
  });

  it('keeps callGemini temperature and maxOutputTokens locked', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/maxOutputTokens:\s*512/);
    expect(index).toMatch(/temperature:\s*0\.7/);
  });

  it('documents MCP tools in docs/mcp-spec.md for the three docs tool ids', () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec).toContain('### `backlink_curate`');
    expect(spec).toContain('### `backlink_genres`');
    expect(spec).toContain('### `backlink_now_playing`');
  });

  it('falls back to music.m3u when the primary category fetch is not ok', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/Fallback to music\.m3u/);
    expect(index).toMatch(/\$\{IPTV_BASE\}\/music\.m3u/);
  });

  it('exports the Hono app as the Worker default', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/export default app/);
    expect(index).toMatch(/new Hono/);
  });

  it('joins mood and genre with slash separator in the Gemini prompt query', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/\[mood,\s*genre\]\.filter\(Boolean\)\.join\(' \/ '\)/);
  });

  it('keeps package description aligned with Gemini curation positioning', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string; version: string };
    expect(pkg.description).toMatch(/iptv-org/i);
    expect(pkg.version).toBe('0.1.0');
  });

  it('keeps parseM3U as a pure export (no network calls in parser module)', () => {
    const parser = read('src/parser.ts');
    expect(parser).not.toMatch(/\bfetch\s*\(/);
    expect(parser).toMatch(/export function parseM3U/);
    expect(parser).toMatch(/export interface Station/);
  });

  it('does not import MCP_MANIFEST into the Worker entry', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/from\s+['"]\.\/mcp['"]/);
    expect(index).not.toContain('MCP_MANIFEST');
  });

  it('builds Gemini URL with generateContent and api key query param', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/generateContent\?key=\$\{apiKey\}/);
    expect(index).toMatch(/method:\s*'POST'/);
  });

  it('keeps CORS middleware registered before route handlers', () => {
    const index = read('src/index.ts');
    const cors = index.indexOf("app.use('*', cors())");
    const firstGet = index.indexOf("app.get('/'");
    expect(cors).toBeGreaterThan(-1);
    expect(firstGet).toBeGreaterThan(cors);
  });

  it('documents HITL escalate constraints in AGENTS.md', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/Escalate to Human/i);
    expect(agents).toMatch(/GEMINI_API_KEY/);
    expect(agents).toMatch(/Production deploy/i);
  });

  it('uses JSON.parse on KV cache hits and JSON.stringify on puts', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/JSON\.parse\(cached\)/);
    expect(index).toMatch(/JSON\.stringify\(stations\)/);
  });

  it('builds the Gemini user-request line from mood and genre with slash join', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/User request:\s*\$\{query\}/);
    expect(index).toMatch(/Available stations:/);
  });

  it('keeps Station typing imported from parser into the Worker entry', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/import\s*\{[^}]*parseM3U[^}]*Station[^}]*\}\s*from\s*['"]\.\/parser['"]/);
  });

  it('keeps resolveGenre / GENRE_MAP / VALID_GENRES wired from genres module', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/from\s*['"]\.\/genres['"]/);
    expect(index).toContain('resolveGenre');
    expect(index).toContain('VALID_GENRES');
    expect(index).toContain('GENRE_MAP');
  });

  it('documents Node 18+ and wrangler secret put in DEPLOY.md', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/Node\.js 18\+/);
    expect(deploy).toMatch(/wrangler secret put GEMINI_API_KEY/);
    expect(deploy).toMatch(/wrangler deploy/);
  });

  it('keeps /curate response curated_by literal stable', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/curated_by:\s*['"]Backlink\/Geryon['"]/);
  });

  it('throws Stream catalog unavailable when music fallback also fails', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/throw new Error\(['"]Stream catalog unavailable['"]\)/);
  });

  it('keeps Env type imported into the Hono bindings generic', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/import\s*\{[^}]*Env[^}]*\}\s*from\s*['"]\.\/types['"]/);
    expect(index).toMatch(/Hono<\{\s*Bindings:\s*Env\s*\}>/);
  });

  it('does not hardcode a Gemini API key in source', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(index).not.toMatch(/GEMINI_API_KEY\s*=\s*['"][^'"]+['"]/);
  });

  it('keeps IPTV_BASE as a https iptv-org categories URL', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(
      /const IPTV_BASE\s*=\s*['"]https:\/\/iptv-org\.github\.io\/iptv\/categories['"]/,
    );
  });

  it('indexes Gemini candidates with optional chaining after [0]', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/data\.candidates\[0\]\?\.content\?\.parts\[0\]\?\.text/);
    expect(index).not.toMatch(/data\.candidates\?\.\[0\]/);
  });

  it('degrades with slice(0, 5) and maps editorial null', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/stations\.slice\(0,\s*5\)\.map/);
    expect(index).toMatch(/editorial:\s*null/);
  });

  it('does not register an /openapi.json route on the Worker', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/app\.get\(['"]\/openapi\.json['"]/);
  });

  it('guards Gemini HTTP errors by throwing before JSON parse', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/if\s*\(!resp\.ok\)\s*throw new Error\(`Gemini API error:/);
  });

  it('extracts Gemini JSON via a bracket-object regex', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/const jsonMatch = text\.match/);
    expect(index).toContain('[\\s\\S]*');
    expect(index).toMatch(/Invalid JSON from Gemini/);
  });

  it('keeps truthy GEMINI_API_KEY guard without trim()', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/if\s*\(!c\.env\.GEMINI_API_KEY\)/);
    expect(index).not.toMatch(/GEMINI_API_KEY\.trim\(/);
  });

  it('documents README catalog fallback behavior for live categories', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/404 and fall back to `music\.m3u`/i);
    expect(readme).toMatch(/editorial:\s*null/);
  });

  it('keeps parser attribute matchers case-insensitive', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/tvg-name="\(\[\^"\]\*\)"\/i/);
    expect(parser).toMatch(/group-title="\(\[\^"\]\*\)"\/i/);
  });

  it('resets current station on non-http non-comment lines', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/Non-http URL \(rtmp:\/\/, etc\.\)/);
    expect(parser).toMatch(/current = \{\}/);
  });

  it('keeps Gemini POST body contents as a single text part', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/contents:\s*\[\s*\{\s*parts:\s*\[\s*\{\s*text:\s*prompt\s*\}\s*\]\s*\}\s*\]/);
  });

  it('returns Curation service unavailable with retry_after 60', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/error:\s*'Curation service unavailable'/);
    expect(index).toMatch(/retry_after:\s*60/);
  });

  it('keeps /stations error payload keys stable', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/error:\s*'Stream catalog unavailable'/);
  });

  it('does not import cors from a relative path', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/from\s+['"]hono\/cors['"]/);
  });

  it('keeps genres module free of network and env access', () => {
    const genres = read('src/genres.ts');
    expect(genres).not.toMatch(/\bfetch\s*\(/);
    expect(genres).not.toMatch(/process\.env|GEMINI_API_KEY/);
  });

  it('keeps mcp module free of network calls', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).not.toMatch(/\bfetch\s*\(/);
    expect(mcp).toMatch(/export const MCP_MANIFEST/);
  });

  it('documents Safe Agent Actions listing test/ in AGENTS.md', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/Add \/ extend unit tests under `test\//);
  });

  it('keeps powered_by branding literal on /', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/powered_by:\s*'Backlink\/Geryon 🦀'/);
  });

  it('uses Date.toISOString for /curate timestamps', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/timestamp:\s*new Date\(\)\.toISOString\(\)/);
  });

  it('joins /curate response query with a single space', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/\[mood,\s*genreParam\]\.filter\(Boolean\)\.join\(' '\)/);
  });

  it('does not register POST handlers on the Worker', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/app\.post\(/);
  });
  it('uses stations: cache key prefix in fetchStations', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/cacheKey\s*=\s*`stations:\$\{genre\}`/);
  });

  it('registers cors middleware exactly once', () => {
    const index = read('src/index.ts');
    const matches = index.match(/app\.use\('\*',\s*cors\(\)\)/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('does not register put or delete HTTP handlers', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/app\.put\(/);
    expect(index).not.toMatch(/app\.delete\(/);
    expect(index).not.toMatch(/app\.patch\(/);
  });

  it('pins Gemini model id to gemini-2.0-flash', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/models\/gemini-2\.0-flash:generateContent/);
    expect(index).not.toMatch(/gemini-1\.5|flash-lite|gemini-2\.5/);
  });

  it('keeps callGemini error string literals stable', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/Gemini API error: \$\{resp\.status\}/);
    expect(index).toMatch(/Invalid JSON from Gemini/);
  });

  it('degrade map copies name url logo only (no language/country)', () => {
    const index = read('src/index.ts');
    const degrade = index.slice(index.indexOf('Graceful degradation'));
    expect(degrade).toMatch(/name:\s*s\.name/);
    expect(degrade).toMatch(/url:\s*s\.url/);
    expect(degrade).toMatch(/logo:\s*s\.logo/);
    expect(degrade).toMatch(/editorial:\s*null/);
    expect(degrade).not.toMatch(/language:/);
    expect(degrade).not.toMatch(/country:/);
  });

  it('resolves /curate genre via genreParam ?? mood order', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/resolveGenre\(genreParam\s*\?\?\s*mood\)/);
  });

  it('documents optional GEMINI_API_KEY and issue #8 in types.ts', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/GEMINI_API_KEY\?:/);
    expect(types).toMatch(/#8/);
    expect(types).toMatch(/Optional at runtime/);
  });

  it('keeps README live caveats for genre 404 fallback and editorial null', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/jazz.*ambient.*404|404.*fall back to `music\.m3u`/s);
    expect(readme).toMatch(/editorial:\s*null/);
  });

  it('keeps DEPLOY.md HITL bullets without push-triggered deploy', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/First production deploy must be reviewed by Andrew/);
    expect(deploy).toMatch(/GEMINI_API_KEY handling require approval/);
    expect(deploy).toMatch(/external data sources requires approval/);
    expect(deploy).not.toMatch(/on:\s*push/i);
  });

  it('keeps AGENTS.md Safe Actions and Escalate sections', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/## Safe Agent Actions/);
    expect(agents).toMatch(/## Escalate to Human/);
    expect(agents).toMatch(/secret management/i);
    expect(agents).toMatch(/CORS or authentication/i);
    expect(agents).toMatch(/CF account configuration/i);
  });

  it('does not import src/mcp from Worker runtime modules', () => {
    for (const file of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/types.ts']) {
      expect(read(file)).not.toMatch(/from\s+['\"]\.\/mcp['\"]/);
    }
  });

  it('locks README Available Genres middot list to VALID_GENRES', () => {
    const readme = read('README.md');
    const genres = read('src/genres.ts');
    const listLine = readme
      .split('\n')
      .find((l) => l.includes('`music`') && l.includes('·') && l.includes('`entertainment`'));
    expect(listLine).toBeTruthy();
    const fromReadme = [...listLine!.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    const fromSrc = [...genres.matchAll(/'([a-z]+)'/g)]
      .map((m) => m[1])
      .filter((g, i, arr) => arr.indexOf(g) === i)
      .slice(0, 9);
    // Prefer explicit VALID_GENRES block order
    const validBlock = genres.slice(genres.indexOf('VALID_GENRES'), genres.indexOf('] as const'));
    const valid = [...validBlock.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(fromReadme).toEqual(valid);
    expect(fromReadme).toEqual([
      'music',
      'ambient',
      'jazz',
      'classical',
      'pop',
      'rock',
      'news',
      'sports',
      'entertainment',
    ]);
    expect(fromSrc.length).toBeGreaterThanOrEqual(9);
  });

  it('locks README alias examples as a subset of GENRE_MAP', () => {
    const readme = read('README.md');
    const genres = read('src/genres.ts');
    expect(readme).toMatch(/`late night` → ambient/);
    expect(readme).toMatch(/`chill` → ambient/);
    expect(readme).toMatch(/`lofi` → ambient/);
    expect(readme).toMatch(/`blues` → jazz/);
    expect(genres).toMatch(/'late night':\s*'ambient'/);
    expect(genres).toMatch(/chill:\s*'ambient'/);
    expect(genres).toMatch(/lofi:\s*'ambient'/);
    expect(genres).toMatch(/blues:\s*'jazz'/);
  });

  it('locks AGENTS.md Verify block to the four npm scripts', () => {
    const agents = read('AGENTS.md');
    const verify = agents.slice(agents.indexOf('## Verify'), agents.indexOf('## Escalate'));
    expect(verify).toMatch(/npm ci/);
    expect(verify).toMatch(/npm run typecheck/);
    expect(verify).toMatch(/npm test/);
    expect(verify).toMatch(/npm run test:coverage/);
  });

  it('keeps README live caveat category list for 404→music.m3u', () => {
    const readme = read('README.md');
    expect(readme).toMatch(
      /`jazz`\/`ambient`\/`classical`\/`pop`\/`rock` files 404 and fall back to `music\.m3u`/,
    );
    expect(readme).toMatch(/Real matching categories today:\s*`music`,\s*`news`,\s*`sports`,\s*`entertainment`/);
  });

  it('keeps callGemini stationList slice at 50 and degrade at 5', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/\.slice\(0,\s*50\)/);
    expect(index).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it('exports default app from src/index.ts', () => {
    expect(read('src/index.ts')).toMatch(/export default app/);
  });

  it('keeps parser seen Set keyed by URL string only', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/seen\.has\(line\)/);
    expect(parser).toMatch(/seen\.add\(line\)/);
  });
});

