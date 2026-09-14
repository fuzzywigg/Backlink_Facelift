import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GENRE_MAP, VALID_GENRES } from '../src/genres';

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

  it('keeps README Available Genres list equal to runtime VALID_GENRES order', () => {
    const readme = read('README.md');
    const afterHeading = readme.split('## Available Genres')[1] ?? '';
    const line = afterHeading.split('\n').find((l) => l.includes('`music`')) ?? '';
    const listed = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(listed).toEqual([...VALID_GENRES]);
  });

  it('documents README alias examples that remain in runtime GENRE_MAP', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/`late night`\s*→\s*ambient/);
    expect(readme).toMatch(/`chill`\s*→\s*ambient/);
    expect(readme).toMatch(/`lofi`\s*→\s*ambient/);
    expect(readme).toMatch(/`blues`\s*→\s*jazz/);
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(GENRE_MAP.lofi).toBe('ambient');
    expect(GENRE_MAP.blues).toBe('jazz');
  });

  it('locks Gemini URL path to include /v1beta/models/', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(
      /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.0-flash:generateContent/,
    );
  });

  it('locks iptv catalog fetch as bare fetch(url) without RequestInit', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/let res = await fetch\(url\);/);
    expect(index).toMatch(/res = await fetch\(`\$\{IPTV_BASE\}\/music\.m3u`\);/);
    expect(index).not.toMatch(/fetch\(url,\s*\{/);
  });

  it('locks /genres aliases assignment to live GENRE_MAP (not a spread copy)', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/aliases:\s*GENRE_MAP/);
    expect(index).not.toMatch(/aliases:\s*\{\s*\.\.\.GENRE_MAP/);
    expect(index).toMatch(/genres:\s*\[\.\.\.VALID_GENRES\]/);
  });

  it('locks exact / endpoint description string literals', () => {
    const index = read('src/index.ts');
    expect(index).toContain("'GET ?genre=&mood= — AI-curated station picks'");
    expect(index).toContain("'GET ?genre= — Raw station list'");
    expect(index).toContain("'GET — Available genre categories'");
    expect(index).toContain("'GET — Health check'");
  });

  it('locks package.json description equal to Worker / description field', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    const index = read('src/index.ts');
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
    expect(index).toContain(`description: '${pkg.description}'`);
  });

  it('locks Env interface to exactly CATALOG_CACHE / GEMINI_API_KEY? / VERSION?', () => {
    const types = read('src/types.ts');
    const iface = types.slice(types.indexOf('export interface Env'), types.indexOf('}', types.indexOf('export interface Env')) + 1);
    expect(iface).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(iface).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(iface).toMatch(/VERSION\?:\s*string/);
    const keys = [...iface.matchAll(/^\s*([A-Z_][A-Z0-9_]*)\??:/gm)].map((m) => m[1]);
    expect(keys).toEqual(['CATALOG_CACHE', 'GEMINI_API_KEY', 'VERSION']);
  });

  it('locks prompt Be specific about mood sentence in callGemini', () => {
    expect(read('src/index.ts')).toContain(
      'Be specific about what makes each station right for the mood',
    );
  });

  it('locks dual join separators: Gemini prompt " / " vs response query spaces', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/\.filter\(Boolean\)\.join\(' \/ '\)/);
    expect(index).toMatch(/\.filter\(Boolean\)\.join\(' '\)/);
  });

  it('locks parseM3U startsWith("#EXTINF") prefix match', () => {
    expect(read('src/parser.ts')).toMatch(/line\.startsWith\('#EXTINF'\)/);
  });

  it('locks resolveGenre default map parameter to GENRE_MAP', () => {
    expect(read('src/genres.ts')).toMatch(
      /map:\s*Record<string,\s*string>\s*=\s*GENRE_MAP/,
    );
  });

  it('locks exact IPTV_BASE string', () => {
    expect(read('src/index.ts')).toMatch(
      /const IPTV_BASE = 'https:\/\/iptv-org\.github\.io\/iptv\/categories';/,
    );
  });

  it('invokes cors() with zero args on app.use("*")', () => {
    expect(read('src/index.ts')).toMatch(/app\.use\('\*',\s*cors\(\)\)/);
  });

  it('registers only GET /, /health, /genres, /stations, /curate', () => {
    const index = read('src/index.ts');
    const routes = [...index.matchAll(/app\.get\('([^']+)'/g)].map((m) => m[1]);
    expect(routes).toEqual(['/', '/health', '/genres', '/stations', '/curate']);
    expect(index).not.toMatch(/app\.(post|put|patch|delete)\(/);
  });

  it('locks exact error and throw literal strings', () => {
    const index = read('src/index.ts');
    expect(index).toContain("throw new Error('Stream catalog unavailable')");
    expect(index).toContain("throw new Error(`Gemini API error: ${resp.status}`)");
    expect(index).toContain("throw new Error('Invalid JSON from Gemini')");
    expect(index).toContain("error: 'Stream catalog unavailable'");
    expect(index).toContain("error: 'Curation service unavailable'");
  });

  it('locks expirationTtl: 3600 exactly in fetchStations', () => {
    expect(read('src/index.ts')).toMatch(/expirationTtl:\s*3600/);
  });

  it('locks degrade editorial: null literal (not undefined)', () => {
    expect(read('src/index.ts')).toMatch(/editorial:\s*null/);
    expect(read('src/index.ts')).not.toMatch(/editorial:\s*undefined/);
  });

  it('keeps filter(Boolean) on both Gemini query and response query joins', () => {
    const index = read('src/index.ts');
    expect((index.match(/\.filter\(Boolean\)/g) ?? []).length).toBe(2);
  });

  it('documents README smtp.eth ecosystem and Andrew link', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/Part of the smtp\.eth ecosystem/);
    expect(readme).toMatch(/\[Andrew Pappas\]\(https:\/\/fuzzywigg\.com\)/);
  });

  it('lists /playlist and /now-playing as allowed Safe Agent Action additions', () => {
    const agents = read('AGENTS.md');
    const safe = agents.slice(agents.indexOf('## Safe Agent Actions'), agents.indexOf('## Verify'));
    expect(safe).toMatch(/\/playlist/);
    expect(safe).toMatch(/\/now-playing/);
  });

  it('escalates billing and CF account configuration to human', () => {
    const escalate = read('AGENTS.md').slice(read('AGENTS.md').indexOf('## Escalate to Human'));
    expect(escalate).toMatch(/billing or CF account configuration/i);
  });

  it('keeps types.ts optional markers only on GEMINI_API_KEY and VERSION', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(types).toMatch(/GEMINI_API_KEY\?:/);
    expect(types).toMatch(/VERSION\?:/);
    expect(types).toMatch(/#8/);
  });

  it('locks Station optional fields exactly logo/group/language/country', () => {
    const parser = read('src/parser.ts');
    const iface = parser.slice(
      parser.indexOf('export interface Station'),
      parser.indexOf('}', parser.indexOf('export interface Station')) + 1,
    );
    const keys = [...iface.matchAll(/^\s*([a-z]+)\??:/gm)].map((m) => m[1]);
    expect(keys).toEqual(['name', 'url', 'logo', 'group', 'language', 'country']);
    expect(iface).toMatch(/logo\?:/);
    expect(iface).toMatch(/group\?:/);
    expect(iface).toMatch(/language\?:/);
    expect(iface).toMatch(/country\?:/);
  });

  it('locks /curate resolveGenre(genreParam ?? mood) nullish coalescing', () => {
    expect(read('src/index.ts')).toMatch(
      /const genre = resolveGenre\(genreParam \?\? mood\);/,
    );
  });

  it('does not log via console in Worker source', () => {
    expect(read('src/index.ts')).not.toMatch(/console\./);
    expect(read('src/parser.ts')).not.toMatch(/console\./);
    expect(read('src/genres.ts')).not.toMatch(/console\./);
    expect(read('src/mcp.ts')).not.toMatch(/console\./);
  });

  it('locks Gemini JSON extraction regex literal', () => {
    expect(read('src/index.ts')).toContain('text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)');
  });

  it('keeps types.ts exporting only the Env interface', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/export interface Env/);
    expect(types).not.toMatch(/export (type|const|function|class|enum)/);
    expect([...types.matchAll(/^export /gm)]).toHaveLength(1);
  });

  it('locks all five parser attribute regexes as case-insensitive double-quote captures', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('tvg-name="([^"]*)"/i');
    expect(parser).toContain('tvg-logo="([^"]*)"/i');
    expect(parser).toContain('group-title="([^"]*)"/i');
    expect(parser).toContain('tvg-language="([^"]*)"/i');
    expect(parser).toContain('tvg-country="([^"]*)"/i');
  });

  it('locks parseM3U http stream detection to lowercase http:// OR https:// startsWith', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(
      /line\.startsWith\('http:\/\/'\)\s*\|\|\s*line\.startsWith\('https:\/\/'\)/,
    );
  });

  it('locks parseM3U URL dedupe via Set.has before push', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/const seen = new Set<string>\(\)/);
    expect(parser).toMatch(/!seen\.has\(line\)/);
    expect(parser).toMatch(/seen\.add\(line\)/);
  });

  it('locks comma display-name fallback via lastIndexOf', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/line\.lastIndexOf\(','\)/);
    expect(parser).toMatch(/line\.slice\(commaIdx \+ 1\)\.trim\(\)/);
  });

  it('locks parseM3U line split to \\n only (no \\r\\n pre-normalize)', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/raw\.split\('\\n'\)\.map\(\(l\) => l\.trim\(\)\)/);
    expect(parser).not.toMatch(/replace\(\/\\r\\n\?\/g/);
    expect(parser).not.toMatch(/split\(\/\\r\?\\n\/\)/);
  });

  it('exports Station interface and parseM3U only from parser.ts', () => {
    const parser = read('src/parser.ts');
    expect([...parser.matchAll(/^export /gm)].map((m) => m[0] + parser.slice(m.index! + 7, m.index! + 40))).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^export interface Station/),
        expect.stringMatching(/^export function parseM3U/),
      ]),
    );
    expect([...parser.matchAll(/^export /gm)]).toHaveLength(2);
  });

  it('always pushes logo/group/language/country even when undefined', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/logo:\s*current\.logo/);
    expect(parser).toMatch(/group:\s*current\.group/);
    expect(parser).toMatch(/language:\s*current\.language/);
    expect(parser).toMatch(/country:\s*current\.country/);
  });

  it('resets current = {} after successful http push and on EXTINF start', () => {
    const parser = read('src/parser.ts');
    const resets = parser.match(/current = \{\}/g) ?? [];
    // EXTINF start, after http push, and non-http non-comment branch
    expect(resets.length).toBe(3);
  });

  it('gates stream push on current.name && !seen.has(line)', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/if \(current\.name && !seen\.has\(line\)\)/);
  });

  it('locks non-http non-comment reset branch condition', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/else if \(line && !line\.startsWith\('#'\)\)/);
  });

  it('types the in-progress entry as Partial<Station>', () => {
    expect(read('src/parser.ts')).toMatch(/let current: Partial<Station> = \{\}/);
  });

  it('does not default-export parser, genres, mcp, or index modules', () => {
    expect(read('src/parser.ts')).not.toMatch(/export default/);
    expect(read('src/genres.ts')).not.toMatch(/export default/);
    expect(read('src/mcp.ts')).not.toMatch(/export default/);
    // Worker entry is the Hono app default export — lock that exception
    expect(read('src/index.ts')).toMatch(/export default app/);
  });

  it('locks Station push object field order name/url/logo/group/language/country', () => {
    const parser = read('src/parser.ts');
    const pushBlock = parser.slice(parser.indexOf('stations.push({'), parser.indexOf('});', parser.indexOf('stations.push({')) + 2);
    expect(pushBlock).toMatch(/name:\s*current\.name/);
    expect(pushBlock).toMatch(/url:\s*line/);
    expect(pushBlock).toMatch(/logo:\s*current\.logo/);
    expect(pushBlock).toMatch(/group:\s*current\.group/);
    expect(pushBlock).toMatch(/language:\s*current\.language/);
    expect(pushBlock).toMatch(/country:\s*current\.country/);
    const nameIdx = pushBlock.indexOf('name:');
    const urlIdx = pushBlock.indexOf('url:');
    const logoIdx = pushBlock.indexOf('logo:');
    const groupIdx = pushBlock.indexOf('group:');
    const langIdx = pushBlock.indexOf('language:');
    const countryIdx = pushBlock.indexOf('country:');
    expect(nameIdx).toBeLessThan(urlIdx);
    expect(urlIdx).toBeLessThan(logoIdx);
    expect(logoIdx).toBeLessThan(groupIdx);
    expect(groupIdx).toBeLessThan(langIdx);
    expect(langIdx).toBeLessThan(countryIdx);
  });

  it('locks VALID_GENRES as a const array and ValidGenre derived type', () => {
    const genres = read('src/genres.ts');
    expect(genres).toMatch(/export const VALID_GENRES = \[/);
    expect(genres).toMatch(/\] as const/);
    expect(genres).toMatch(
      /export type ValidGenre = \(typeof VALID_GENRES\)\[number\]/,
    );
  });

  it('locks MCP_MANIFEST.tools length at exactly 4 in source', () => {
    const mcp = read('src/mcp.ts');
    expect((mcp.match(/name:\s*"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(mcp).toContain('station_select');
    expect(mcp).toContain('now_playing');
    expect(mcp).toContain('genre_filter');
    expect(mcp).toContain('curator_prompt');
    expect((mcp.match(/^\s+name:\s*"/gm) ?? []).length).toBe(4);
  });

  it('locks IPTV_BASE as a module-local const (not exported)', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(
      /const IPTV_BASE = 'https:\/\/iptv-org\.github\.io\/iptv\/categories'/,
    );
    expect(index).not.toMatch(/export.*IPTV_BASE/);
  });

  it('imports cors from hono/cors and applies via app.use', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/import \{ cors \} from 'hono\/cors'/);
    expect(index).toMatch(/app\.use\('\*', cors\(\)\)/);
  });

  it('locks Gemini generationConfig maxOutputTokens 512 and temperature 0.7', () => {
    expect(read('src/index.ts')).toMatch(
      /generationConfig:\s*\{\s*maxOutputTokens:\s*512,\s*temperature:\s*0\.7\s*\}/,
    );
  });

  it('locks catalog prompt slice(0, 50) and degrade slice(0, 5)', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/stations\s*\n?\s*\.slice\(0,\s*50\)/);
    expect(index).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it('locks resolveGenre falsy default return music and unknown fallback music', () => {
    const genres = read('src/genres.ts');
    expect(genres).toMatch(/if \(!input\) return 'music'/);
    expect(genres).toMatch(
      /return map\[lower\] \?\? \(VALID_GENRES\.includes\(lower as ValidGenre\) \? lower : 'music'\)/,
    );
  });

  it('locks cacheKey template stations:${genre}', () => {
    expect(read('src/index.ts')).toContain('stations:${genre}');
  });

  it('keeps parseM3U as a pure synchronous function (no async/await)', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/export function parseM3U\(raw: string\): Station\[\]/);
    expect(parser).not.toMatch(/async|await|Promise/);
  });

  it('locks Worker root endpoints object keys exactly', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/'\/curate':/);
    expect(index).toMatch(/'\/stations':/);
    expect(index).toMatch(/'\/genres':/);
    expect(index).toMatch(/'\/health':/);
    expect(index).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('exports the full helpers.ts surface used by route tests', () => {
    const helpers = read('test/helpers.ts');
    for (const name of [
      'mockKV',
      'testEnv',
      'SAMPLE_M3U',
      'geminiTextResponse',
      'stubIptvAndGemini',
      'curatedGeminiJson',
      'iptvCategoryUrl',
      'countHttpStreamLines',
      'buildSimpleM3U',
      'seedStationsCache',
      'captureGeminiRequest',
      'iptvCallsWithInit',
    ]) {
      expect(helpers).toMatch(new RegExp(`export (function|const) ${name}\\b`));
    }
  });

  it('locks helpers stubIptvAndGemini host match substrings', () => {
    const helpers = read('test/helpers.ts');
    expect(helpers).toContain("url.includes('iptv-org')");
    expect(helpers).toContain("url.includes('generativelanguage.googleapis.com')");
  });

  it('locks helpers iptvCategoryUrl base to iptv-org categories path', () => {
    expect(read('test/helpers.ts')).toContain(
      'https://iptv-org.github.io/iptv/categories/${genre}.m3u',
    );
  });

  it('locks helpers seedStationsCache key template stations:${genre}', () => {
    expect(read('test/helpers.ts')).toContain('stations:${genre}');
  });

  it('locks helpers countHttpStreamLines to http:// and https:// startsWith only', () => {
    const helpers = read('test/helpers.ts');
    expect(helpers).toMatch(
      /l\.startsWith\('http:\/\/'\) \|\| l\.startsWith\('https:\/\/'\)/,
    );
  });

  it('locks helpers mockKV get miss to null (not undefined)', () => {
    expect(read('test/helpers.ts')).toMatch(/store\.get\(key\) \?\? null/);
  });

  it('locks helpers testEnv default VERSION to 0.1.0-test', () => {
    expect(read('test/helpers.ts')).toMatch(/VERSION:\s*'0\.1\.0-test'/);
  });

  it('locks helpers buildSimpleM3U attr order name/logo/group/language/country', () => {
    const helpers = read('test/helpers.ts');
    const block = helpers.slice(
      helpers.indexOf('export function buildSimpleM3U'),
      helpers.indexOf('export function seedStationsCache'),
    );
    const nameIdx = block.indexOf('tvg-name=');
    const logoIdx = block.indexOf('tvg-logo=');
    const groupIdx = block.indexOf('group-title=');
    const langIdx = block.indexOf('tvg-language=');
    const countryIdx = block.indexOf('tvg-country=');
    expect(nameIdx).toBeGreaterThan(-1);
    expect(logoIdx).toBeGreaterThan(nameIdx);
    expect(groupIdx).toBeGreaterThan(logoIdx);
    expect(langIdx).toBeGreaterThan(groupIdx);
    expect(countryIdx).toBeGreaterThan(langIdx);
  });

  it('locks helpers captureGeminiRequest to first generativelanguage call', () => {
    const helpers = read('test/helpers.ts');
    expect(helpers).toMatch(/fetchMock\.mock\.calls\.find/);
    expect(helpers).toContain("includes('generativelanguage.googleapis.com')");
  });

  it('locks helpers curatedGeminiJson default Alpha FM fixture fields', () => {
    const helpers = read('test/helpers.ts');
    expect(helpers).toContain("name: 'Alpha FM'");
    expect(helpers).toContain("url: 'https://example.com/alpha.m3u8'");
    expect(helpers).toContain("editorial: 'Default curated pick.'");
    expect(helpers).toContain("genre: 'music'");
  });

  it('locks MCP_MANIFEST export as a const object literal (not a factory)', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/export const MCP_MANIFEST = \{/);
    expect(mcp).not.toMatch(/function\s+createManifest|MCP_MANIFEST\s*=\s*\(/);
  });

  it('locks mcp.ts free of fetch, KV, and Hono imports', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).not.toMatch(/from ['\"]hono|fetch\(|KVNamespace|GEMINI/);
  });

  it('locks genres.ts free of fetch and Hono imports', () => {
    const genres = read('src/genres.ts');
    expect(genres).not.toMatch(/from ['\"]hono|fetch\(|KVNamespace/);
  });

  it('locks resolveGenre signature with optional input and defaulted map', () => {
    expect(read('src/genres.ts')).toMatch(
      /export function resolveGenre\(\s*input\?: string,\s*map: Record<string, string> = GENRE_MAP,\s*\): string/,
    );
  });

  it('locks GENRE_MAP as a Record<string, string> annotated const', () => {
    expect(read('src/genres.ts')).toMatch(
      /export const GENRE_MAP: Record<string, string> = \{/,
    );
  });

  it('locks mcp type string literals to none/openapi/object/string only', () => {
    const mcp = read('src/mcp.ts');
    const types = [...mcp.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(types)).toEqual(new Set(['none', 'openapi', 'object', 'string']));
  });

  it('locks mcp.ts auth type none and api openapi url literals', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/auth:\s*\{\s*type:\s*"none"\s*\}/);
    expect(mcp).toMatch(/api:\s*\{\s*type:\s*"openapi",\s*url:\s*"\/openapi\.json"\s*\}/);
  });

  it('locks genres module comment documenting iptv-org category ids', () => {
    expect(read('src/genres.ts')).toMatch(/iptv-org category ids/);
  });

  it('locks VALID_GENRES length 9 in source text (nine quoted slugs)', () => {
    const genres = read('src/genres.ts');
    const block = genres.slice(genres.indexOf('VALID_GENRES'), genres.indexOf('as const'));
    expect((block.match(/'[a-z]+'/g) ?? []).length).toBe(9);
  });

  it('locks MCP schema_version v1 literal in source', () => {
    expect(read('src/mcp.ts')).toMatch(/schema_version:\s*"v1"/);
  });

  it('locks claw-mcp tool names as string literals in source order', () => {
    const mcp = read('src/mcp.ts');
    const names = [...mcp.matchAll(/name:\s*"(station_select|now_playing|genre_filter|curator_prompt)"/g)].map(
      (m) => m[1],
    );
    expect(names).toEqual(['station_select', 'now_playing', 'genre_filter', 'curator_prompt']);
  });

  it('locks resolveGenre toLowerCase().trim() pipeline order', () => {
    expect(read('src/genres.ts')).toMatch(
      /const lower = input\.toLowerCase\(\)\.trim\(\);/,
    );
  });

  it('does not import genres into mcp or mcp into genres', () => {
    expect(read('src/mcp.ts')).not.toMatch(/from ['\"]\.\/genres/);
    expect(read('src/genres.ts')).not.toMatch(/from ['\"]\.\/mcp/);
  });

  it('locks GENRE_MAP late night key as a quoted multi-word literal', () => {
    expect(read('src/genres.ts')).toMatch(/'late night':\s*'ambient'/);
    expect(read('src/genres.ts')).toMatch(/'lo-fi':\s*'ambient'/);
  });

  it('locks MCP_MANIFEST name_for_model and name_for_human string literals', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/name_for_model:\s*"backlink"/);
    expect(mcp).toMatch(/name_for_human:\s*"Backlink Radio"/);
  });

  it('locks callGemini to read only candidates[0] and parts[0].text', () => {
    const index = read('src/index.ts');
    expect(index).toContain('data.candidates[0]?.content?.parts[0]?.text');
    expect(index).not.toMatch(/candidates\[1\]/);
    expect(index).not.toMatch(/parts\[1\]/);
  });

  it('locks /curate resolveGenre to genreParam ?? mood (genre wins when present)', () => {
    expect(read('src/index.ts')).toMatch(/resolveGenre\(genreParam\s*\?\?\s*mood\)/);
  });

  it('locks /curate query join to [mood, genreParam].filter(Boolean).join(" ")', () => {
    expect(read('src/index.ts')).toMatch(
      /const query = \[mood, genreParam\]\.filter\(Boolean\)\.join\(' '\) \|\| genre/,
    );
  });

  it('locks Gemini user-request join to [mood, genre].filter(Boolean).join(" / ")', () => {
    expect(read('src/index.ts')).toMatch(
      /const query = \[mood, genre\]\.filter\(Boolean\)\.join\(' \/ '\)/,
    );
  });

  it('locks VERSION fallbacks to ?? \'0.1.0\' on / and /health', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/c\.env\.VERSION \?\? '0\.1\.0'/);
    expect((index.match(/c\.env\.VERSION \?\? '0\.1\.0'/g) ?? []).length).toBe(2);
  });

  it('locks powered_by crab emoji literal on root handler', () => {
    expect(read('src/index.ts')).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('locks curated_by Backlink/Geryon without crab emoji', () => {
    const index = read('src/index.ts');
    expect(index).toContain("curated_by: 'Backlink/Geryon'");
    expect(index).not.toMatch(/curated_by: 'Backlink\/Geryon 🦀'/);
  });

  it('locks retry_after numeric literal 60 on both 503 paths', () => {
    const index = read('src/index.ts');
    expect((index.match(/retry_after:\s*60/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('locks music fallback fetch to bare IPTV_BASE template with no RequestInit', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/res = await fetch\(`\$\{IPTV_BASE\}\/music\.m3u`\);/);
    expect(index).not.toMatch(/fetch\(`\$\{IPTV_BASE\}\/music\.m3u`,\s*\{/);
  });

  it('locks Gemini JSON extract regex to require object inside array', () => {
    expect(read('src/index.ts')).toContain('text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)');
  });

  it('locks stationList group/language fallbacks to genre and en', () => {
    expect(read('src/index.ts')).toContain('${s.group ?? genre}');
    expect(read('src/index.ts')).toContain("${s.language ?? 'en'}");
  });
  it('does not export fetchStations or callGemini from index', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/export\s+(async\s+)?function\s+fetchStations/);
    expect(index).not.toMatch(/export\s+(async\s+)?function\s+callGemini/);
    expect(index).toMatch(/export default app/);
  });

  it('locks GEMINI_API_KEY falsy guard before fetchStations on /curate', () => {
    const index = read('src/index.ts');
    const keyGuard = index.indexOf("if (!c.env.GEMINI_API_KEY)");
    const fetchStations = index.indexOf('stations = await fetchStations(genre', keyGuard);
    expect(keyGuard).toBeGreaterThan(-1);
    expect(fetchStations).toBeGreaterThan(keyGuard);
  });

  it('locks degrade editorial null literal (not undefined) in /curate catch', () => {
    expect(read('src/index.ts')).toMatch(/editorial:\s*null/);
  });

  it('locks parseM3U to split on newline then trim each line', () => {
    expect(read('src/parser.ts')).toContain("raw.split('\\n').map((l) => l.trim())");
  });

  it('locks parseM3U EXTINF branch to clear current before attr extraction', () => {
    const parser = read('src/parser.ts');
    const extinf = parser.indexOf("if (line.startsWith('#EXTINF'))");
    const clear = parser.indexOf('current = {}', extinf);
    const nameMatch = parser.indexOf('tvg-name=', extinf);
    expect(extinf).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(extinf);
    expect(nameMatch).toBeGreaterThan(clear);
  });

  it('locks parseM3U http branch to require current.name before push', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/if \(current\.name && !seen\.has\(line\)\)/);
    expect(parser).toMatch(/stations\.push\(\{/);
  });

  it('locks parseM3U Station interface required fields name and url only', () => {
    const parser = read('src/parser.ts');
    const iface = parser.slice(
      parser.indexOf('export interface Station'),
      parser.indexOf('}', parser.indexOf('export interface Station')) + 1,
    );
    expect(iface).toMatch(/name:\s*string/);
    expect(iface).toMatch(/url:\s*string/);
    expect(iface).toMatch(/logo\?:\s*string/);
    expect(iface).toMatch(/group\?:\s*string/);
    expect(iface).toMatch(/language\?:\s*string/);
    expect(iface).toMatch(/country\?:\s*string/);
  });

  it('locks parseM3U to never import hono, genres, or mcp', () => {
    const parser = read('src/parser.ts');
    expect(parser).not.toMatch(/from ['\"]\.\/genres|from ['\"]\.\/mcp|from ['\"]hono/);
    expect(parser).not.toMatch(/^import /m);
  });

  it('locks parseM3U comma fallback only when !current.name', () => {
    expect(read('src/parser.ts')).toMatch(/if \(!current\.name\) \{\s*\n\s*const commaIdx/);
  });

  it('locks parseM3U seen Set to be function-local (not module-level)', () => {
    const parser = read('src/parser.ts');
    const fnStart = parser.indexOf('export function parseM3U');
    const seen = parser.indexOf('const seen = new Set<string>()', fnStart);
    expect(seen).toBeGreaterThan(fnStart);
    expect(parser.indexOf('const seen = new Set')).toBe(seen);
  });

  it('locks parseM3U push to always include logo/group/language/country keys', () => {
    const parser = read('src/parser.ts');
    const push = parser.slice(parser.indexOf('stations.push({'), parser.indexOf('});', parser.indexOf('stations.push({')) + 2);
    expect(push).toContain('logo: current.logo');
    expect(push).toContain('group: current.group');
    expect(push).toContain('language: current.language');
    expect(push).toContain('country: current.country');
  });

  it('locks parseM3U non-http reset to require truthy line and not start with #', () => {
    expect(read('src/parser.ts')).toContain("else if (line && !line.startsWith('#'))");
  });

  it('locks index to call parseM3U on raw M3U text before KV put', () => {
    const index = read('src/index.ts');
    const parseCall = index.indexOf('const stations = parseM3U(raw)');
    const putCall = index.indexOf('await kv.put(cacheKey', parseCall);
    expect(parseCall).toBeGreaterThan(-1);
    expect(putCall).toBeGreaterThan(parseCall);
  });

  it('locks helpers buildSimpleM3U to emit #EXTINF:-1 prefix', () => {
    expect(read('test/helpers.ts')).toContain('`#EXTINF:-1 ${attrs},${s.name}`');
  });

  it('locks helpers countHttpStreamLines to trim then filter http(s) startsWith', () => {
    const helpers = read('test/helpers.ts');
    expect(helpers).toMatch(/\.split\('\\n'\)/);
    expect(helpers).toMatch(/\.map\(\(l\) => l\.trim\(\)\)/);
    expect(helpers).toMatch(/l\.startsWith\('http:\/\/'\) \|\| l\.startsWith\('https:\/\/'\)/);
  });

  it('locks /genres handler to spread VALID_GENRES and pass GENRE_MAP by reference', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/genres:\s*\[\.\.\.VALID_GENRES\]/);
    expect(index).toMatch(/aliases:\s*GENRE_MAP/);
  });

  it('locks resolveGenre import into Worker from ./genres', () => {
    expect(read('src/index.ts')).toMatch(
      /import\s*\{\s*GENRE_MAP,\s*VALID_GENRES,\s*resolveGenre\s*\}\s*from\s*['"]\.\/genres['"]/,
    );
  });

  it('locks /stations to resolveGenre(genreParam) without mood coalescing', () => {
    const index = read('src/index.ts');
    const stations = index.slice(index.indexOf("app.get('/stations'"));
    expect(stations).toMatch(/const genre = resolveGenre\(genreParam\);/);
    expect(stations.slice(0, stations.indexOf("app.get('/curate'"))).not.toMatch(
      /resolveGenre\(genreParam\s*\?\?/,
    );
  });

  it('locks /curate to resolveGenre(genreParam ?? mood)', () => {
    expect(read('src/index.ts')).toMatch(
      /const genre = resolveGenre\(genreParam \?\? mood\);/,
    );
  });

  it('locks MCP_MANIFEST auth none while Worker uses cors() open', () => {
    expect(read('src/mcp.ts')).toMatch(/auth:\s*\{\s*type:\s*"none"\s*\}/);
    expect(read('src/index.ts')).toMatch(/app\.use\('\*',\s*cors\(\)\)/);
  });

  it('locks MCP_MANIFEST api.url /openapi.json without a matching Worker route', () => {
    expect(read('src/mcp.ts')).toMatch(/url:\s*"\/openapi\.json"/);
    expect(read('src/index.ts')).not.toMatch(/app\.get\(['"]\/openapi\.json['"]/);
  });

  it('locks claw-mcp tool names distinct from docs/mcp-spec backlink_* ids', () => {
    const mcp = read('src/mcp.ts');
    const spec = read('docs/mcp-spec.md');
    for (const name of ['station_select', 'genre_filter', 'curator_prompt']) {
      expect(mcp).toContain(`name: "${name}"`);
      expect(spec).not.toContain(name);
    }
    // now_playing is a substring of docs id backlink_now_playing — lock that asymmetry
    expect(mcp).toContain('name: "now_playing"');
    expect(spec).toContain('backlink_now_playing');
    expect(spec).not.toMatch(/### `now_playing`/);
    for (const id of ['backlink_curate', 'backlink_genres', 'backlink_now_playing']) {
      expect(spec).toContain(id);
      expect(mcp).not.toContain(id);
    }
  });

  it('locks GENRE_MAP and VALID_GENRES exports as const in genres.ts', () => {
    const genres = read('src/genres.ts');
    expect(genres).toMatch(/export const GENRE_MAP/);
    expect(genres).toMatch(/export const VALID_GENRES/);
    expect(genres).toMatch(/\] as const;/);
    expect(genres).toMatch(/export type ValidGenre/);
    expect(genres).toMatch(/export function resolveGenre/);
  });

  it('locks ValidGenre as typeof VALID_GENRES number indexed type', () => {
    expect(read('src/genres.ts')).toMatch(
      /export type ValidGenre = \(typeof VALID_GENRES\)\[number\];/,
    );
  });

  it('locks resolveGenre includes check cast to ValidGenre', () => {
    expect(read('src/genres.ts')).toMatch(
      /VALID_GENRES\.includes\(lower as ValidGenre\)\s*\?\s*lower\s*:\s*'music'/,
    );
  });

  it('locks genres module header comment about iptv-org category ids', () => {
    expect(read('src/genres.ts')).toMatch(
      /\/\*\* iptv-org category ids we expose \+ mood aliases → category\./,
    );
  });

  it('locks MCP_MANIFEST schema_version v1 double-quoted string', () => {
    expect(read('src/mcp.ts')).toMatch(/schema_version:\s*"v1"/);
  });

  it('locks MCP tools array length at 4 via source count of name: fields under tools', () => {
    const mcp = read('src/mcp.ts');
    const toolNames = [...mcp.matchAll(/name:\s*"([a-z_]+)"/g)]
      .map((m) => m[1])
      .filter((n) => n !== 'backlink');
    // name_for_model is "backlink"; tool names are the four snake_case tools
    expect(toolNames.filter((n) => n.includes('_') || n === 'now_playing')).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('locks Env GEMINI_API_KEY optional comment referencing issue #8', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/\/\*\* Optional at runtime — `\/curate` returns 503 when unset \(#8\)\./);
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string;/);
  });

  it('locks types.ts to export only Env (no Station duplication)', () => {
    const types = read('src/types.ts');
    expect(types).not.toMatch(/interface Station/);
    expect(types).not.toMatch(/GENRE_MAP|VALID_GENRES|MCP_MANIFEST/);
  });

  it('locks callGemini prompt top 3 stations wording', () => {
    expect(read('src/index.ts')).toContain('pick the top 3 stations with a short editorial blurb');
  });

  it('locks docs mcp-spec top 3 wording against Worker prompt top 3', () => {
    expect(read('docs/mcp-spec.md')).toMatch(/top 3 radio stations/i);
    expect(read('src/index.ts')).toContain('top 3 stations');
  });

  it('locks docs graceful degradation top 5 against Worker slice(0, 5)', () => {
    expect(read('docs/mcp-spec.md')).toMatch(/top 5 raw stations/);
    expect(read('src/index.ts')).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it('locks /genres as the only route that returns GENRE_MAP aliases', () => {
    const index = read('src/index.ts');
    expect((index.match(/aliases:\s*GENRE_MAP/g) ?? []).length).toBe(1);
    expect(index).toMatch(/app\.get\('\/genres'/);
  });

  it('does not reference MCP_MANIFEST from genres or types', () => {
    expect(read('src/genres.ts')).not.toMatch(/MCP_MANIFEST|mcp/);
    expect(read('src/types.ts')).not.toMatch(/MCP_MANIFEST|mcp/);
  });

  it('locks README Available Genres middot list to VALID_GENRES order', () => {
    const readme = read('README.md');
    const line = readme
      .split('\n')
      .find((l) => l.includes('`music`') && l.includes('·') && l.includes('`entertainment`'));
    const listed = [...(line ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(listed).toEqual([...VALID_GENRES]);
  });

  it('locks README alias examples subset of GENRE_MAP', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/`late night` → ambient/);
    expect(readme).toMatch(/`chill` → ambient/);
    expect(readme).toMatch(/`lofi` → ambient/);
    expect(readme).toMatch(/`blues` → jazz/);
    expect(GENRE_MAP['late night']).toBe('ambient');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(GENRE_MAP.lofi).toBe('ambient');
    expect(GENRE_MAP.blues).toBe('jazz');
  });

  it('locks AGENTS.md Safe Actions to include genres.ts mapping updates', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/Update station genre mappings in `src\/genres\.ts`/);
    expect(agents).toMatch(/wired from `src\/index\.ts`/);
  });

  it('locks MCP description_for_human iptv-org catalog substring', () => {
    expect(read('src/mcp.ts')).toContain('iptv-org catalog');
  });

  it('locks MCP description_for_model AI-curated IPTV radio substring', () => {
    expect(read('src/mcp.ts')).toContain('AI-curated IPTV radio service');
  });

  it('locks curator_prompt required mood and optional genre in source', () => {
    const mcp = read('src/mcp.ts');
    const curator = mcp.slice(mcp.indexOf('name: "curator_prompt"'));
    expect(curator).toMatch(/required:\s*\["mood"\]/);
    expect(curator).toMatch(/genre:\s*\{\s*\n\s*type:\s*"string"/);
  });

  it('locks now_playing input_schema to empty properties object in source', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/name: "now_playing"[\s\S]*?input_schema:\s*\{\s*type:\s*"object",\s*properties:\s*\{\s*\}/);
  });

  it('locks station_select required station_name in source', () => {
    expect(read('src/mcp.ts')).toMatch(/required:\s*\["station_name"\]/);
  });

  it('locks genre_filter required genre in source', () => {
    expect(read('src/mcp.ts')).toMatch(/required:\s*\["genre"\]/);
  });

  it('locks /curate query fallback || genre when mood and genreParam absent', () => {
    expect(read('src/index.ts')).toMatch(
      /const query = \[mood, genreParam\]\.filter\(Boolean\)\.join\(' '\) \|\| genre/,
    );
  });

  it('locks Worker root name Backlink and package description alignment', () => {
    const index = read('src/index.ts');
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(index).toMatch(/name:\s*'Backlink'/);
    expect(index).toContain(`description: '${pkg.description}'`);
  });

  it('locks genres.ts free of Hono and fetch', () => {
    const genres = read('src/genres.ts');
    expect(genres).not.toMatch(/hono|fetch\(|KVNamespace|GEMINI/);
  });

  it('locks mcp.ts free of Hono and fetch', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).not.toMatch(/hono|fetch\(|KVNamespace|GEMINI/);
  });

  it('locks docs/mcp-spec Base URL to https://backlink.fuzzywigg.com', () => {
    expect(read('docs/mcp-spec.md')).toMatch(
      /Base URL:\s*`https:\/\/backlink\.fuzzywigg\.com`/,
    );
  });

  it('locks GENRE_MAP entry count at 21 in source object literal', () => {
    const genres = read('src/genres.ts');
    const block = genres.slice(genres.indexOf('export const GENRE_MAP'), genres.indexOf('};') + 1);
    const keys = [...block.matchAll(/^\s*(?:'([^']+)'|([a-z-]+))\s*:/gm)].map(
      (m) => m[1] ?? m[2],
    );
    expect(keys).toHaveLength(21);
  });

  it('locks VALID_GENRES length at 9 in source array literal', () => {
    const genres = read('src/genres.ts');
    const block = genres.slice(
      genres.indexOf('export const VALID_GENRES'),
      genres.indexOf('] as const'),
    );
    const items = [...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(items).toHaveLength(9);
    expect(items).toEqual([...VALID_GENRES]);
  });

  it('locks genres.ts to export GENRE_MAP VALID_GENRES ValidGenre resolveGenre', () => {
    const genres = read('src/genres.ts');
    expect(genres).toContain('export const GENRE_MAP');
    expect(genres).toContain('export const VALID_GENRES');
    expect(genres).toContain('export type ValidGenre');
    expect(genres).toContain('export function resolveGenre');
  });

  it('locks parser.ts to export Station interface and parseM3U function only', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('export interface Station');
    expect(parser).toContain('export function parseM3U');
    expect(parser).not.toMatch(/export default/);
  });

  it('locks index.ts route registrations for / /health /genres /stations /curate', () => {
    const index = read('src/index.ts');
    for (const route of ["'/'", "'/health'", "'/genres'", "'/stations'", "'/curate'"]) {
      expect(index).toContain(`app.get(${route}`);
    }
  });

  it('locks index fetchStations cacheKey template stations:${genre}', () => {
    expect(read('src/index.ts')).toContain('`stations:${genre}`');
  });

  it('locks index callGemini model path gemini-2.0-flash:generateContent', () => {
    expect(read('src/index.ts')).toContain('gemini-2.0-flash:generateContent');
  });

  it('locks parser http bind to require current.name and !seen.has(line)', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('if (current.name && !seen.has(line))');
  });

  // --- HEAVY burn (post-#39): source ↔ product / docs fences ---

  it('locks IPTV_BASE const to iptv-org categories CDN', () => {
    expect(read('src/index.ts')).toContain(
      "const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'",
    );
  });

  it('locks fetchStations cacheKey to stations:${genre} template', () => {
    expect(read('src/index.ts')).toContain('const cacheKey = `stations:${genre}`');
  });

  it('locks fetchStations music.m3u fallback URL construction', () => {
    expect(read('src/index.ts')).toContain('`${IPTV_BASE}/music.m3u`');
  });

  it('locks fetchStations throw message Stream catalog unavailable', () => {
    expect(read('src/index.ts')).toContain("throw new Error('Stream catalog unavailable')");
  });

  it('locks callGemini generationConfig maxOutputTokens 512 temperature 0.7', () => {
    const index = read('src/index.ts');
    expect(index).toContain('maxOutputTokens: 512');
    expect(index).toContain('temperature: 0.7');
  });

  it('locks callGemini content-type application/json header', () => {
    expect(read('src/index.ts')).toContain("'content-type': 'application/json'");
  });

  it('locks callGemini Invalid JSON from Gemini error string', () => {
    expect(read('src/index.ts')).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it('locks callGemini Gemini API error template with status', () => {
    expect(read('src/index.ts')).toContain('`Gemini API error: ${resp.status}`');
  });

  it('locks /curate Curation service unavailable 503 payload', () => {
    expect(read('src/index.ts')).toContain(
      "return c.json({ error: 'Curation service unavailable', retry_after: 60 }, 503)",
    );
  });

  it('locks /stations and /curate catalog 503 retry_after 60', () => {
    const index = read('src/index.ts');
    expect(
      (index.match(/error: 'Stream catalog unavailable', retry_after: 60/g) ?? []).length,
    ).toBe(2);
  });

  it('locks root powered_by Backlink/Geryon crab emoji', () => {
    expect(read('src/index.ts')).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('locks curated_by response field to Backlink/Geryon', () => {
    expect(read('src/index.ts')).toContain("curated_by: 'Backlink/Geryon'");
  });

  it('locks /health ok true shape', () => {
    expect(read('src/index.ts')).toContain('return c.json({ ok: true, version: c.env.VERSION ?? ');
  });

  it('locks VERSION fallback 0.1.0 on root and health', () => {
    const index = read('src/index.ts');
    expect((index.match(/c\.env\.VERSION \?\? '0\.1\.0'/g) ?? []).length).toBe(2);
  });

  it('locks Hono Bindings Env generic on app', () => {
    expect(read('src/index.ts')).toContain('const app = new Hono<{ Bindings: Env }>()');
  });

  it('locks export default app at end of index', () => {
    expect(read('src/index.ts').trimEnd().endsWith('export default app;')).toBe(true);
  });

  it('locks index imports GENRE_MAP VALID_GENRES resolveGenre from genres', () => {
    expect(read('src/index.ts')).toContain(
      "import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres'",
    );
  });

  it('locks index imports parseM3U Station from parser', () => {
    expect(read('src/index.ts')).toContain("import { parseM3U, Station } from './parser'");
  });

  it('locks index imports Env from types', () => {
    expect(read('src/index.ts')).toContain("import { Env } from './types'");
  });

  it('locks index imports cors from hono/cors', () => {
    expect(read('src/index.ts')).toContain("import { cors } from 'hono/cors'");
  });

  it('does not register POST PUT PATCH DELETE routes in index', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/app\.(post|put|patch|delete)\(/);
  });

  it('does not invent /playlist /now-playing /openapi.json Worker handlers', () => {
    const index = read('src/index.ts');
    expect(index).not.toContain("app.get('/playlist'");
    expect(index).not.toContain("app.get('/now-playing'");
    expect(index).not.toContain("app.get('/openapi.json'");
  });

  it('locks parser Station interface fields name url logo group language country', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('name: string');
    expect(parser).toContain('url: string');
    expect(parser).toContain('logo?: string');
    expect(parser).toContain('group?: string');
    expect(parser).toContain('language?: string');
    expect(parser).toContain('country?: string');
  });

  it('locks parser tvg-name tvg-logo group-title tvg-language tvg-country extractors', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('tvg-name=');
    expect(parser).toContain('tvg-logo=');
    expect(parser).toContain('group-title=');
    expect(parser).toContain('tvg-language=');
    expect(parser).toContain('tvg-country=');
  });

  it('locks parser seen Set and current Partial Station', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('const seen = new Set<string>()');
    expect(parser).toContain('let current: Partial<Station> = {}');
  });

  it('locks parser http bind to http:// or https:// startsWith', () => {
    expect(read('src/parser.ts')).toContain(
      "line.startsWith('http://') || line.startsWith('https://')",
    );
  });

  it('locks parser non-http non-comment branch to reset current', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain("else if (line && !line.startsWith('#'))");
    expect(parser).toContain('current = {}');
  });

  it('locks genres resolveGenre default music when input falsy', () => {
    expect(read('src/genres.ts')).toContain("if (!input) return 'music'");
  });

  it('locks genres resolveGenre toLowerCase trim lookup', () => {
    expect(read('src/genres.ts')).toContain('const lower = input.toLowerCase().trim()');
  });

  it('locks genres resolveGenre map default parameter GENRE_MAP', () => {
    expect(read('src/genres.ts')).toContain('map: Record<string, string> = GENRE_MAP');
  });

  it('locks MCP_MANIFEST schema_version v1', () => {
    expect(read('src/mcp.ts')).toContain('schema_version: "v1"');
  });

  it('locks MCP_MANIFEST name_for_model backlink', () => {
    expect(read('src/mcp.ts')).toContain('name_for_model: "backlink"');
  });

  it('locks MCP_MANIFEST name_for_human Backlink Radio', () => {
    expect(read('src/mcp.ts')).toContain('name_for_human: "Backlink Radio"');
  });

  it('locks MCP_MANIFEST auth type none', () => {
    expect(read('src/mcp.ts')).toContain('auth: { type: "none" }');
  });

  it('locks MCP_MANIFEST api openapi url /openapi.json', () => {
    expect(read('src/mcp.ts')).toContain('api: { type: "openapi", url: "/openapi.json" }');
  });

  it('locks types Env CATALOG_CACHE required and GEMINI/VERSION optional', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/CATALOG_CACHE:\s*KVNamespace/);
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string/);
    expect(types).toMatch(/VERSION\?:\s*string/);
  });

  it('locks types.ts free of Station interface duplication', () => {
    expect(read('src/types.ts')).not.toMatch(/interface Station/);
  });

  it('locks callGemini prompt You are Backlink AI radio curator', () => {
    expect(read('src/index.ts')).toContain('You are Backlink, an AI radio curator');
  });

  it('locks callGemini query join mood / genre with filter Boolean', () => {
    expect(read('src/index.ts')).toContain(
      "const query = [mood, genre].filter(Boolean).join(' / ')",
    );
  });

  it('locks /curate query join mood genreParam with space and || genre', () => {
    expect(read('src/index.ts')).toContain(
      'const query = [mood, genreParam].filter(Boolean).join(\' \') || genre',
    );
  });

  it('locks /genres response to spread VALID_GENRES and aliases GENRE_MAP', () => {
    const index = read('src/index.ts');
    expect(index).toContain('genres: [...VALID_GENRES]');
    expect(index).toContain('aliases: GENRE_MAP');
  });

  it('locks /stations response shape genre count stations', () => {
    expect(read('src/index.ts')).toContain(
      'return c.json({ genre, count: stations.length, stations })',
    );
  });

  it('locks root endpoints map keys /curate /stations /genres /health', () => {
    const index = read('src/index.ts');
    expect(index).toContain("'/curate':");
    expect(index).toContain("'/stations':");
    expect(index).toContain("'/genres':");
    expect(index).toContain("'/health':");
  });

  it('locks fetchStations JSON.parse cached as Station array', () => {
    expect(read('src/index.ts')).toContain('return JSON.parse(cached) as Station[]');
  });

  it('locks fetchStations kv.put expirationTtl 3600', () => {
    expect(read('src/index.ts')).toContain(
      'await kv.put(cacheKey, JSON.stringify(stations), { expirationTtl: 3600 })',
    );
  });

  it('locks callGemini jsonMatch regex for array-of-objects', () => {
    expect(read('src/index.ts')).toContain(
      'const jsonMatch = text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)',
    );
  });

  it('locks degrade map to editorial null and genre from resolved', () => {
    const index = read('src/index.ts');
    expect(index).toContain('editorial: null');
    expect(index).toMatch(/stations\.slice\(0,\s*5\)\.map/);
  });

  it('locks /curate resolveGenre(genreParam ?? mood)', () => {
    expect(read('src/index.ts')).toContain('const genre = resolveGenre(genreParam ?? mood)');
  });

  it('locks /stations resolveGenre(genreParam) without mood', () => {
    expect(read('src/index.ts')).toContain('const genre = resolveGenre(genreParam)');
  });

  it('genres.ts does not import from index parser mcp or hono', () => {
    const genres = read('src/genres.ts');
    expect(genres).not.toMatch(/from ['\"]\.\//);
    expect(genres).not.toMatch(/from ['\"]hono/);
  });

  it('parser.ts does not import from other src modules', () => {
    expect(read('src/parser.ts')).not.toMatch(/^import /m);
  });

  it('mcp.ts does not import from other src modules', () => {
    expect(read('src/mcp.ts')).not.toMatch(/^import /m);
  });

  it('types.ts does not import from other src modules', () => {
    expect(read('src/types.ts')).not.toMatch(/^import /m);
  });

  it('locks GENRE_MAP late night and lo-fi keys to ambient', () => {
    const genres = read('src/genres.ts');
    expect(genres).toContain("'late night': 'ambient'");
    expect(genres).toContain("'lo-fi': 'ambient'");
  });

  it('locks VALID_GENRES as const tuple export', () => {
    expect(read('src/genres.ts')).toContain('] as const');
    expect(read('src/genres.ts')).toContain('export const VALID_GENRES');
  });

  it('locks MCP tools curator_prompt required mood array', () => {
    expect(read('src/mcp.ts')).toContain('required: ["mood"]');
  });

  it('locks MCP tools station_select required station_name', () => {
    expect(read('src/mcp.ts')).toContain('required: ["station_name"]');
  });

  it('locks MCP tools genre_filter required genre', () => {
    expect(read('src/mcp.ts')).toContain('required: ["genre"]');
  });

  it('locks index free of MCP_MANIFEST import', () => {
    expect(read('src/index.ts')).not.toContain('MCP_MANIFEST');
    expect(read('src/index.ts')).not.toMatch(/from ['\"]\.\/mcp['\"]/);
  });

  it('locks callGemini model path gemini-2.0-flash not 1.5', () => {
    const index = read('src/index.ts');
    expect(index).toContain('gemini-2.0-flash:generateContent');
    expect(index).not.toMatch(/gemini-1\.5/);
  });

  it('locks root description string matching package description substring', () => {
    expect(read('src/index.ts')).toContain(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('locks /curate timestamp to new Date().toISOString()', () => {
    expect(read('src/index.ts')).toContain('timestamp: new Date().toISOString()');
  });

  it('locks parser #EXTINF branch to reset current before attribute extract', () => {
    const parser = read('src/parser.ts');
    const extinf = parser.indexOf("if (line.startsWith('#EXTINF'))");
    const reset = parser.indexOf('current = {}', extinf);
    const nameMatch = parser.indexOf('tvg-name', extinf);
    expect(reset).toBeGreaterThan(extinf);
    expect(nameMatch).toBeGreaterThan(reset);
  });

  it('locks Env comment referencing issue #8 for optional GEMINI', () => {
    expect(read('src/types.ts')).toMatch(/#8/);
  });

  it('locks IPTV_BASE exact const string assignment', () => {
    expect(read('src/index.ts')).toContain(
      "const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'",
    );
  });

  it('locks cacheKey shape stations:${genre} adjacent to kv.get', () => {
    const index = read('src/index.ts');
    expect(index).toContain('const cacheKey = `stations:${genre}`');
    expect(index).toContain('const cached = await kv.get(cacheKey)');
    expect(index.indexOf('const cacheKey')).toBeLessThan(index.indexOf('kv.get(cacheKey)'));
  });

  it('locks Gemini generationConfig maxOutputTokens 512 and temperature 0.7 order', () => {
    const index = read('src/index.ts');
    expect(index).toContain('generationConfig: { maxOutputTokens: 512, temperature: 0.7 }');
    const genIdx = index.indexOf('generationConfig:');
    const maxIdx = index.indexOf('maxOutputTokens: 512', genIdx);
    const tempIdx = index.indexOf('temperature: 0.7', genIdx);
    expect(maxIdx).toBeGreaterThan(genIdx);
    expect(tempIdx).toBeGreaterThan(maxIdx);
  });

  it('locks 503 Stream catalog unavailable payload with retry_after 60', () => {
    const index = read('src/index.ts');
    expect(index).toContain(
      "return c.json({ error: 'Stream catalog unavailable', retry_after: 60 }, 503)",
    );
    expect(
      (index.match(/error: 'Stream catalog unavailable', retry_after: 60/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('locks 503 Curation service unavailable payload with retry_after 60', () => {
    expect(read('src/index.ts')).toContain(
      "return c.json({ error: 'Curation service unavailable', retry_after: 60 }, 503)",
    );
  });

  it('locks Hono Bindings Env generic on app construction', () => {
    expect(read('src/index.ts')).toContain('const app = new Hono<{ Bindings: Env }>()');
  });

  it('locks index export default app fence at file end', () => {
    const index = read('src/index.ts').trimEnd();
    expect(index.endsWith('export default app;')).toBe(true);
  });

  it('locks callGemini prompt join with User request and Available stations labels', () => {
    const index = read('src/index.ts');
    expect(index).toContain('User request: ${query}');
    expect(index).toContain('Available stations:\\n${stationList}');
    expect(index.indexOf('User request:')).toBeLessThan(index.indexOf('Available stations:'));
  });

  it('locks query join mood / genre with filter(Boolean)', () => {
    expect(read('src/index.ts')).toContain(
      "const query = [mood, genre].filter(Boolean).join(' / ')",
    );
  });

  it('locks IPTV fetch URL template `${IPTV_BASE}/${genre}.m3u`', () => {
    expect(read('src/index.ts')).toContain('const url = `${IPTV_BASE}/${genre}.m3u`');
  });

  it('locks music.m3u fallback path `${IPTV_BASE}/music.m3u`', () => {
    expect(read('src/index.ts')).toContain('await fetch(`${IPTV_BASE}/music.m3u`)');
  });

  it('locks Gemini fetch URL template with gemini-2.0-flash:generateContent', () => {
    expect(read('src/index.ts')).toContain(
      '`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`',
    );
  });

  it('locks content-type application/json header adjacent to POST method', () => {
    const index = read('src/index.ts');
    const methodIdx = index.indexOf("method: 'POST'");
    const headerIdx = index.indexOf("'content-type': 'application/json'");
    expect(methodIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(methodIdx);
  });

  it('locks parser Station interface field order name url logo group language country', () => {
    const parser = read('src/parser.ts');
    const iface = parser.slice(parser.indexOf('export interface Station'), parser.indexOf('}'));
    const nameIdx = iface.indexOf('name: string');
    const urlIdx = iface.indexOf('url: string');
    const logoIdx = iface.indexOf('logo?: string');
    const groupIdx = iface.indexOf('group?: string');
    const langIdx = iface.indexOf('language?: string');
    const countryIdx = iface.indexOf('country?: string');
    expect(nameIdx).toBeLessThan(urlIdx);
    expect(urlIdx).toBeLessThan(logoIdx);
    expect(logoIdx).toBeLessThan(groupIdx);
    expect(groupIdx).toBeLessThan(langIdx);
    expect(langIdx).toBeLessThan(countryIdx);
  });

  it('locks parser http scheme filter startsWith http:// or https://', () => {
    expect(read('src/parser.ts')).toContain(
      "line.startsWith('http://') || line.startsWith('https://')",
    );
  });

  it('locks genres VALID_GENRES export fence and GENRE_MAP export', () => {
    const genres = read('src/genres.ts');
    expect(genres).toContain('export const GENRE_MAP');
    expect(genres).toContain('export const VALID_GENRES');
    expect(genres).toContain('] as const');
  });

  it('locks VALID_GENRES tuple order starting music ambient jazz', () => {
    const genres = read('src/genres.ts');
    const block = genres.slice(genres.indexOf('export const VALID_GENRES'), genres.indexOf('] as const'));
    expect(block.indexOf("'music'")).toBeLessThan(block.indexOf("'ambient'"));
    expect(block.indexOf("'ambient'")).toBeLessThan(block.indexOf("'jazz'"));
    expect(block.indexOf("'jazz'")).toBeLessThan(block.indexOf("'classical'"));
  });

  it('locks MCP_MANIFEST schema_version v1 and auth type none', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('schema_version: "v1"');
    expect(mcp).toContain('auth: { type: "none" }');
    expect(mcp).toContain('name_for_model: "backlink"');
  });

  it('locks MCP tool name order station_select now_playing genre_filter curator_prompt', () => {
    const mcp = read('src/mcp.ts');
    const select = mcp.indexOf('name: "station_select"');
    const now = mcp.indexOf('name: "now_playing"');
    const genre = mcp.indexOf('name: "genre_filter"');
    const curator = mcp.indexOf('name: "curator_prompt"');
    expect(select).toBeGreaterThan(-1);
    expect(now).toBeGreaterThan(select);
    expect(genre).toBeGreaterThan(now);
    expect(curator).toBeGreaterThan(genre);
  });

  it('locks types Env field order CATALOG_CACHE then optional GEMINI then VERSION', () => {
    const types = read('src/types.ts');
    const cache = types.indexOf('CATALOG_CACHE: KVNamespace');
    const gemini = types.indexOf('GEMINI_API_KEY?: string');
    const version = types.indexOf('VERSION?: string');
    expect(cache).toBeGreaterThan(-1);
    expect(gemini).toBeGreaterThan(cache);
    expect(version).toBeGreaterThan(gemini);
  });

  it('locks cors middleware registration before route handlers', () => {
    const index = read('src/index.ts');
    expect(index.indexOf("app.use('*', cors())")).toBeLessThan(index.indexOf("app.get('/'"));
  });

  it('locks /health ok true version fallback 0.1.0', () => {
    expect(read('src/index.ts')).toContain(
      "return c.json({ ok: true, version: c.env.VERSION ?? '0.1.0' })",
    );
  });

  it('locks stationList map template with group language and url', () => {
    expect(read('src/index.ts')).toContain(
      '`${i + 1}. ${s.name} (${s.group ?? genre}) [${s.language ?? \'en\'}] — ${s.url}`',
    );
  });

  it('locks Backlink curator prompt opening sentence fence', () => {
    expect(read('src/index.ts')).toContain(
      'You are Backlink, an AI radio curator. Given this list of radio stations',
    );
  });

  it('cross-locks IPTV_BASE host with wrangler custom domain host family', () => {
    const index = read('src/index.ts');
    const toml = read('wrangler.toml');
    expect(index).toContain('iptv-org.github.io');
    expect(toml).toContain('backlink.fuzzywigg.com');
    expect(index).not.toContain('backlink.fuzzywigg.com');
  });


  // --- HEAVY burn (post-#46): helpers/CI/wrangler/source/mcp-spec deepen ---
  it('locks IPTV_BASE constant to iptv-org categories CDN', () => {
    expect(read('src/index.ts')).toContain(
      "const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'",
    );
  });

  it('locks fetchStations cacheKey template stations:${genre}', () => {
    expect(read('src/index.ts')).toContain('const cacheKey = `stations:${genre}`');
  });

  it('locks fetchStations music.m3u fallback after primary !res.ok', () => {
    const index = read('src/index.ts');
    expect(index).toContain("fetch(`${IPTV_BASE}/music.m3u`)");
    expect(index).toContain("throw new Error('Stream catalog unavailable')");
  });

  it('locks callGemini POST content-type application/json', () => {
    expect(read('src/index.ts')).toContain("headers: { 'content-type': 'application/json' }");
    expect(read('src/index.ts')).toContain("method: 'POST'");
  });

  it('locks callGemini error to Gemini API error status template', () => {
    expect(read('src/index.ts')).toContain('throw new Error(`Gemini API error: ${resp.status}`)');
  });

  it('locks callGemini Invalid JSON from Gemini when regex misses', () => {
    expect(read('src/index.ts')).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it('locks callGemini station list format with group language url', () => {
    expect(read('src/index.ts')).toContain(
      "`${i + 1}. ${s.name} (${s.group ?? genre}) [${s.language ?? 'en'}] — ${s.url}`",
    );
  });

  it('locks root name Backlink and version from env', () => {
    const index = read('src/index.ts');
    expect(index).toContain("name: 'Backlink'");
    expect(index).toContain('version: c.env.VERSION ?? \'0.1.0\'');
  });

  it('locks /curate Curation service unavailable 503 when key missing', () => {
    expect(read('src/index.ts')).toContain(
      "return c.json({ error: 'Curation service unavailable', retry_after: 60 }, 503)",
    );
  });

  it('locks GENRE_MAP entry count and known alias targets', () => {
    const keys = Object.keys(GENRE_MAP);
    expect(keys.length).toBe(21);
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(GENRE_MAP.metal).toBe('rock');
    expect(GENRE_MAP.dance).toBe('pop');
    expect(GENRE_MAP.blues).toBe('jazz');
  });

  it('locks VALID_GENRES length 9 in documented order', () => {
    expect([...VALID_GENRES]).toEqual([
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
  });

  it('locks ValidGenre type export derived from VALID_GENRES', () => {
    expect(read('src/genres.ts')).toContain(
      'export type ValidGenre = (typeof VALID_GENRES)[number]',
    );
  });

  it('locks MCP_MANIFEST tools length 4 with stable names', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('name: "station_select"');
    expect(mcp).toContain('name: "now_playing"');
    expect(mcp).toContain('name: "genre_filter"');
    expect(mcp).toContain('name: "curator_prompt"');
  });

  it('locks MCP now_playing input_schema empty properties object', () => {
    expect(read('src/mcp.ts')).toContain(
      'input_schema: { type: "object", properties: {} }',
    );
  });

  it('locks MCP description_for_model mentions IPTV radio and mood', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/AI-curated IPTV radio service/);
    expect(mcp).toMatch(/best station for a mood/);
  });

  it('locks MCP description_for_human to iptv-org catalog phrase', () => {
    expect(read('src/mcp.ts')).toContain(
      'description_for_human: "AI-curated live radio from the iptv-org catalog."',
    );
  });

  it('locks parser split map trim line pipeline', () => {
    expect(read('src/parser.ts')).toContain(
      "const lines = raw.split('\\n').map((l) => l.trim())",
    );
  });

  it('locks parser name fallback via lastIndexOf comma', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('const commaIdx = line.lastIndexOf(\',\')');
    expect(parser).toContain('current.name = line.slice(commaIdx + 1).trim()');
  });

  it('locks parser attribute regexes as case-insensitive', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('tvg-name="([^"]*)"/i');
    expect(parser).toContain('tvg-logo="([^"]*)"/i');
    expect(parser).toContain('group-title="([^"]*)"/i');
    expect(parser).toContain('tvg-language="([^"]*)"/i');
    expect(parser).toContain('tvg-country="([^"]*)"/i');
  });

  it('locks parser dedupe by URL via seen.has(line)', () => {
    expect(read('src/parser.ts')).toContain('if (current.name && !seen.has(line))');
    expect(read('src/parser.ts')).toContain('seen.add(line)');
  });

  it('locks types Env comment Optional at runtime for GEMINI', () => {
    expect(read('src/types.ts')).toContain('Optional at runtime');
    expect(read('src/types.ts')).toContain('/curate` returns 503 when unset');
  });

  it('locks index free of Anthropic Claude Haiku strings', () => {
    expect(read('src/index.ts')).not.toMatch(/anthropic|claude|haiku/i);
  });

  it('locks all src modules free of process.env usage', () => {
    for (const rel of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(read(rel)).not.toContain('process.env');
    }
  });

  it('locks index free of console.log debug statements', () => {
    expect(read('src/index.ts')).not.toMatch(/console\.(log|debug|info|warn)/);
  });

  it('locks GENRE_MAP electronic and lofi and lo-fi to ambient', () => {
    expect(GENRE_MAP.electronic).toBe('ambient');
    expect(GENRE_MAP.lofi).toBe('ambient');
    expect(GENRE_MAP['lo-fi']).toBe('ambient');
  });

  it('locks GENRE_MAP classic to classical and indie to rock', () => {
    expect(GENRE_MAP.classic).toBe('classical');
    expect(GENRE_MAP.indie).toBe('rock');
  });

  it('locks /genres route to return c.json with genres and aliases only', () => {
    expect(read('src/index.ts')).toMatch(
      /return c\.json\(\{\s*genres: \[\.\.\.VALID_GENRES\],\s*aliases: GENRE_MAP,\s*\}\)/,
    );
  });

  it('locks callGemini return type fields name url logo editorial genre', () => {
    expect(read('src/index.ts')).toContain(
      'Promise<Array<{ name: string; url: string; logo?: string; editorial: string; genre: string }>>',
    );
  });

  it('locks fetchStations to parseM3U(raw) after res.text()', () => {
    const index = read('src/index.ts');
    expect(index).toContain('const raw = await res.text()');
    expect(index).toContain('const stations = parseM3U(raw)');
  });

  it('locks cors middleware registered before routes', () => {
    const index = read('src/index.ts');
    const cors = index.indexOf("app.use('*', cors())");
    const root = index.indexOf("app.get('/',");
    expect(cors).toBeGreaterThan(-1);
    expect(root).toBeGreaterThan(cors);
  });

  it('locks MCP curator_prompt properties mood and genre', () => {
    const mcp = read('src/mcp.ts');
    const start = mcp.indexOf('name: "curator_prompt"');
    const section = mcp.slice(start);
    expect(section).toContain('mood:');
    expect(section).toContain('genre:');
    expect(section).toContain('required: ["mood"]');
  });

  it('locks MCP station_select required station_name only', () => {
    const mcp = read('src/mcp.ts');
    const start = mcp.indexOf('name: "station_select"');
    const section = mcp.slice(start, mcp.indexOf('name: "now_playing"'));
    expect(section).toContain('required: ["station_name"]');
    expect(section).not.toContain('required: ["mood"]');
  });

  it('locks genres.ts file header comment about iptv-org category ids', () => {
    expect(read('src/genres.ts')).toContain(
      'iptv-org category ids we expose + mood aliases → category',
    );
  });

  it('locks index default export and no named app export', () => {
    const index = read('src/index.ts');
    expect(index).toContain('export default app');
    expect(index).not.toMatch(/export \{ app \}/);
  });

  it('locks parser Station export as interface not type alias', () => {
    expect(read('src/parser.ts')).toContain('export interface Station');
  });

  it('locks resolveGenre unknown input fallback to music via VALID_GENRES check', () => {
    expect(read('src/genres.ts')).toContain(
      "return map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : 'music')",
    );
  });

  it('locks callGemini contents parts text prompt shape', () => {
    expect(read('src/index.ts')).toContain(
      'contents: [{ parts: [{ text: prompt }] }]',
    );
  });

  it('locks /curate response keys query curated_by timestamp stations', () => {
    const index = read('src/index.ts');
    expect(index).toContain('query,');
    expect(index).toContain("curated_by: 'Backlink/Geryon'");
    expect(index).toContain('timestamp: new Date().toISOString()');
    expect(index).toContain('stations: curated');
  });

  it('locks degrade path to map name url logo editorial null genre', () => {
    const index = read('src/index.ts');
    expect(index).toContain('name: s.name');
    expect(index).toContain('url: s.url');
    expect(index).toContain('logo: s.logo');
    expect(index).toContain('editorial: null');
  });

  it('locks MCP_MANIFEST export as const object not function', () => {
    expect(read('src/mcp.ts')).toMatch(/^export const MCP_MANIFEST = \{/m);
  });

  it('src tree stays five modules only', () => {
    const files = readdirSync(join(root, 'src')).sort();
    expect(files).toEqual(['genres.ts', 'index.ts', 'mcp.ts', 'parser.ts', 'types.ts']);
  });

  // --- HEAVY burn (post-#53): source ↔ product contract deepen ---

  it('locks callGemini generationConfig maxOutputTokens 512 temperature 0.7', () => {
    expect(read('src/index.ts')).toContain(
      'generationConfig: { maxOutputTokens: 512, temperature: 0.7 }',
    );
  });

  it('locks Gemini generateContent URL path v1beta models gemini-2.0-flash', () => {
    expect(read('src/index.ts')).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=',
    );
  });

  it('locks Gemini JSON extract regex open-bracket object close-bracket', () => {
    expect(read('src/index.ts')).toContain('text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)');
  });

  it('locks callGemini candidates[0] parts[0] text coalesce empty', () => {
    expect(read('src/index.ts')).toContain(
      "const text = data.candidates[0]?.content?.parts[0]?.text ?? ''",
    );
  });

  it('locks /curate query join mood genreParam fallback genre', () => {
    expect(read('src/index.ts')).toContain(
      "const query = [mood, genreParam].filter(Boolean).join(' ') || genre",
    );
  });

  it('locks callGemini query join mood genre with slash separator', () => {
    expect(read('src/index.ts')).toContain(
      "const query = [mood, genre].filter(Boolean).join(' / ')",
    );
  });

  it('locks root powered_by Backlink/Geryon crab emoji', () => {
    expect(read('src/index.ts')).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('locks root endpoints map keys /curate /stations /genres /health', () => {
    const index = read('src/index.ts');
    expect(index).toContain("'/curate': 'GET ?genre=&mood= — AI-curated station picks'");
    expect(index).toContain("'/stations': 'GET ?genre= — Raw station list'");
    expect(index).toContain("'/genres': 'GET — Available genre categories'");
    expect(index).toContain("'/health': 'GET — Health check'");
  });

  it('locks /stations response shape genre count stations', () => {
    expect(read('src/index.ts')).toContain('return c.json({ genre, count: stations.length, stations })');
  });

  it('locks /stations and /curate catalog 503 identical error payload', () => {
    const index = read('src/index.ts');
    expect([...index.matchAll(/error: 'Stream catalog unavailable', retry_after: 60/g)]).toHaveLength(
      2,
    );
  });

  it('locks exactly three retry_after 60 occurrences', () => {
    expect([...read('src/index.ts').matchAll(/retry_after:\s*60/g)]).toHaveLength(3);
  });

  it('locks exactly three , 503) status returns', () => {
    expect([...read('src/index.ts').matchAll(/,\s*503\)/g)]).toHaveLength(3);
  });

  it('locks exactly five app.get route registrations', () => {
    expect([...read('src/index.ts').matchAll(/app\.get\(/g)]).toHaveLength(5);
  });

  it('locks route registration order / then /health /genres /stations /curate', () => {
    const index = read('src/index.ts');
    const root = index.indexOf("app.get('/',");
    const health = index.indexOf("app.get('/health'");
    const genres = index.indexOf("app.get('/genres'");
    const stations = index.indexOf("app.get('/stations'");
    const curate = index.indexOf("app.get('/curate'");
    expect(root).toBeGreaterThan(-1);
    expect(health).toBeGreaterThan(root);
    expect(genres).toBeGreaterThan(health);
    expect(stations).toBeGreaterThan(genres);
    expect(curate).toBeGreaterThan(stations);
  });

  it('locks Hono Bindings Env generic on app', () => {
    expect(read('src/index.ts')).toContain("const app = new Hono<{ Bindings: Env }>()");
  });

  it('locks imports cors from hono/cors and Hono from hono', () => {
    const index = read('src/index.ts');
    expect(index).toContain("import { Hono } from 'hono'");
    expect(index).toContain("import { cors } from 'hono/cors'");
  });

  it('locks genres import GENRE_MAP VALID_GENRES resolveGenre', () => {
    expect(read('src/index.ts')).toContain(
      "import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres'",
    );
  });

  it('locks parser import parseM3U Station', () => {
    expect(read('src/index.ts')).toContain("import { parseM3U, Station } from './parser'");
  });

  it('locks types import Env', () => {
    expect(read('src/index.ts')).toContain("import { Env } from './types'");
  });

  it('locks /curate resolveGenre(genreParam ?? mood)', () => {
    expect(read('src/index.ts')).toContain('const genre = resolveGenre(genreParam ?? mood)');
  });

  it('locks /stations resolveGenre(genreParam) without mood', () => {
    const index = read('src/index.ts');
    const stations = index.slice(index.indexOf("app.get('/stations'"), index.indexOf("app.get('/curate'"));
    expect(stations).toContain('const genre = resolveGenre(genreParam)');
    expect(stations).not.toContain('mood');
  });

  it('locks fetchStations signature genre string kv KVNamespace', () => {
    expect(read('src/index.ts')).toContain(
      'async function fetchStations(genre: string, kv: KVNamespace): Promise<Station[]>',
    );
  });

  it('locks callGemini signature apiKey stations genre mood optional', () => {
    expect(read('src/index.ts')).toContain(
      'async function callGemini(\n  apiKey: string,\n  stations: Station[],\n  genre: string,\n  mood?: string,\n)',
    );
  });

  it('locks curated_by exact Backlink/Geryon without crab on /curate', () => {
    expect(read('src/index.ts')).toContain("curated_by: 'Backlink/Geryon'");
    expect(read('src/index.ts')).not.toContain("curated_by: 'Backlink/Geryon 🦀'");
  });

  it('locks Env interface export with three fields only', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/^export interface Env \{/m);
    expect(types).toContain('CATALOG_CACHE: KVNamespace');
    expect(types).toContain('GEMINI_API_KEY?: string');
    expect(types).toContain('VERSION?: string');
    expect(types).not.toContain('ACCOUNT_ID');
  });

  it('locks types.ts file length under 10 lines lean', () => {
    expect(read('src/types.ts').split('\n').length).toBeLessThanOrEqual(10);
  });

  it('locks index.ts free of eval Function new Function', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/\beval\s*\(/);
    expect(index).not.toContain('new Function');
  });

  it('locks index.ts free of WebSocket DurableObject', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/WebSocket|DurableObject|D1Database/i);
  });

  it('locks index free of fetchStations export — private helper', () => {
    expect(read('src/index.ts')).not.toMatch(/export\s+(async\s+)?function\s+fetchStations/);
    expect(read('src/index.ts')).not.toMatch(/export\s+(async\s+)?function\s+callGemini/);
  });

  it('locks MCP_MANIFEST tools required mood only on curator_prompt in source', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('required: ["mood"]');
    expect(mcp).toContain('required: ["station_name"]');
    expect(mcp).toContain('required: ["genre"]');
  });

  it('locks MCP api url /openapi.json in source text', () => {
    expect(read('src/mcp.ts')).toContain('url: "/openapi.json"');
    expect(read('src/mcp.ts')).toContain('type: "openapi"');
  });

  it('locks parser Station fields name url logo group language country optional mix', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('name: string');
    expect(parser).toContain('url: string');
    expect(parser).toContain('logo?: string');
    expect(parser).toContain('group?: string');
    expect(parser).toContain('language?: string');
    expect(parser).toContain('country?: string');
  });

  it('locks parser export function parseM3U', () => {
    expect(read('src/parser.ts')).toMatch(/export function parseM3U\(raw: string\): Station\[\]/);
  });

  it('locks genres VALID_GENRES as readonly array export', () => {
    expect(read('src/genres.ts')).toMatch(/export const VALID_GENRES = \[/);
    expect(read('src/genres.ts')).toContain('] as const');
  });

  it('locks genres GENRE_MAP as Record or satisfies string values in source', () => {
    expect(read('src/genres.ts')).toMatch(/export const GENRE_MAP/);
  });

  it('locks resolveGenre export function signature', () => {
    expect(read('src/genres.ts')).toMatch(
      /export function resolveGenre\(/,
    );
  });

  it('cross-locks root description with package.json description', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(read('src/index.ts')).toContain(`description: '${pkg.description}'`);
  });

  it('cross-locks VERSION fallback 0.1.0 with package.json version', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
    expect(read('src/index.ts')).toContain(`c.env.VERSION ?? '${pkg.version}'`);
  });

  it('locks index line count under 160 lean worker budget', () => {
    expect(read('src/index.ts').split('\n').length).toBeLessThanOrEqual(160);
  });

  it('locks mcp.ts line count under 80 lean manifest budget', () => {
    expect(read('src/mcp.ts').split('\n').length).toBeLessThanOrEqual(80);
  });

  it('locks no TODO FIXME HACK XXX in src tree', () => {
    for (const rel of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(read(rel)).not.toMatch(/TODO|FIXME|HACK|XXX/);
    }
  });

  it('locks no any type assertions in index via as any', () => {
    expect(read('src/index.ts')).not.toContain('as any');
    expect(read('src/parser.ts')).not.toContain('as any');
    expect(read('src/genres.ts')).not.toContain('as any');
  });

  it('locks expirationTtl 3600 exactly once in index', () => {
    expect([...read('src/index.ts').matchAll(/expirationTtl:\s*3600/g)]).toHaveLength(1);
  });

  it('locks stations.slice(0, 50) and stations.slice(0, 5) both present', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/\.slice\(0,\s*50\)/);
    expect(index).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it('locks top 3 stations wording in Gemini prompt', () => {
    expect(read('src/index.ts')).toContain('pick the top 3 stations');
  });

  it('locks Return JSON only array-of-objects instruction in prompt', () => {
    expect(read('src/index.ts')).toContain('Return JSON only:');
  });

  it('locks User request and Available stations prompt labels', () => {
    const index = read('src/index.ts');
    expect(index).toContain('User request: ${query}');
    expect(index).toContain('Available stations:\\n${stationList}');
  });

  // --- HEAVY burn (post-#68): source ↔ product / docs / digest deepen ---

  it("locks sha256 of index.ts", () => {
    const src = read("src/index.ts");
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

  it("locks sha1 of index.ts", () => {
    expect(createHash('sha1').update(read("src/index.ts"), 'utf8').digest('hex')).toBe("88b9273a584ce23d1da7ca8a147fee7faeee640b");
  });

  it("locks md5 of index.ts", () => {
    expect(createHash('md5').update(read("src/index.ts"), 'utf8').digest('hex')).toBe("8c9cdb320becf0effa2d8027b66a2177");
  });

  it("locks UTF-8 byte length of index.ts via TextEncoder and fs.statSync", () => {
    const src = read("src/index.ts");
    expect(new TextEncoder().encode(src).length).toBe(4738);
    expect(statSync(join(root, "src/index.ts")).size).toBe(4738);
    expect(Buffer.byteLength(src, 'utf8')).toBe(4738);
  });

  it("locks char length and split line count of index.ts", () => {
    const src = read("src/index.ts");
    expect(src.length).toBe(4724);
    expect(src.split('\n').length).toBe(154);
    expect(src.split('\n').filter((l) => l.length > 0).length).toBe(125);
    expect((src.match(/\n/g) ?? []).length).toBe(153);
  });

  it("locks sha256 prefix/suffix of index.ts", () => {
    const digest = createHash('sha256').update(read("src/index.ts"), 'utf8').digest('hex');
    expect(digest.startsWith("7f0d574b")).toBe(true);
    expect(digest.endsWith("e0313a72")).toBe(true);
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks charCodeAt sum of index.ts", () => {
    const sum = [...read("src/index.ts")].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(488918);
  });

  it("locks LF-only no BOM no tabs for index.ts", () => {
    const src = read("src/index.ts");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.includes('\t')).toBe(false);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks first four char codes of index.ts", () => {
    expect([...read("src/index.ts").slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([105,109,112,111]);
  });

  it("locks Buffer.from equals TextEncoder for index.ts", () => {
    const src = read("src/index.ts");
    expect([...Buffer.from(src, 'utf8')]).toEqual([...new TextEncoder().encode(src)]);
  });

  it("locks sha256 of parser.ts", () => {
    const src = read("src/parser.ts");
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it("locks sha1 of parser.ts", () => {
    expect(createHash('sha1').update(read("src/parser.ts"), 'utf8').digest('hex')).toBe("701cdecbef5a9049af6bd11497493c4036a60211");
  });

  it("locks md5 of parser.ts", () => {
    expect(createHash('md5').update(read("src/parser.ts"), 'utf8').digest('hex')).toBe("500211c4c526de887252451726776563");
  });

  it("locks UTF-8 byte length of parser.ts via TextEncoder and fs.statSync", () => {
    const src = read("src/parser.ts");
    expect(new TextEncoder().encode(src).length).toBe(1955);
    expect(statSync(join(root, "src/parser.ts")).size).toBe(1955);
    expect(Buffer.byteLength(src, 'utf8')).toBe(1955);
  });

  it("locks char length and split line count of parser.ts", () => {
    const src = read("src/parser.ts");
    expect(src.length).toBe(1953);
    expect(src.split('\n').length).toBe(67);
    expect(src.split('\n').filter((l) => l.length > 0).length).toBe(56);
    expect((src.match(/\n/g) ?? []).length).toBe(66);
  });

  it("locks sha256 prefix/suffix of parser.ts", () => {
    const digest = createHash('sha256').update(read("src/parser.ts"), 'utf8').digest('hex');
    expect(digest.startsWith("cf293136")).toBe(true);
    expect(digest.endsWith("621f4368")).toBe(true);
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks charCodeAt sum of parser.ts", () => {
    const sum = [...read("src/parser.ts")].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(160347);
  });

  it("locks LF-only no BOM no tabs for parser.ts", () => {
    const src = read("src/parser.ts");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.includes('\t')).toBe(false);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks first four char codes of parser.ts", () => {
    expect([...read("src/parser.ts").slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([101,120,112,111]);
  });

  it("locks Buffer.from equals TextEncoder for parser.ts", () => {
    const src = read("src/parser.ts");
    expect([...Buffer.from(src, 'utf8')]).toEqual([...new TextEncoder().encode(src)]);
  });

  it("locks sha256 of genres.ts", () => {
    const src = read("src/genres.ts");
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("locks sha1 of genres.ts", () => {
    expect(createHash('sha1').update(read("src/genres.ts"), 'utf8').digest('hex')).toBe("3dd586bfd23c91e9719b56c90c8cbfe038aebc3e");
  });

  it("locks md5 of genres.ts", () => {
    expect(createHash('md5').update(read("src/genres.ts"), 'utf8').digest('hex')).toBe("ee8d34506f688c9e3097b89a35d48aa5");
  });

  it("locks UTF-8 byte length of genres.ts via TextEncoder and fs.statSync", () => {
    const src = read("src/genres.ts");
    expect(new TextEncoder().encode(src).length).toBe(1027);
    expect(statSync(join(root, "src/genres.ts")).size).toBe(1027);
    expect(Buffer.byteLength(src, 'utf8')).toBe(1027);
  });

  it("locks char length and split line count of genres.ts", () => {
    const src = read("src/genres.ts");
    expect(src.length).toBe(1025);
    expect(src.split('\n').length).toBe(48);
    expect(src.split('\n').filter((l) => l.length > 0).length).toBe(44);
    expect((src.match(/\n/g) ?? []).length).toBe(47);
  });

  it("locks sha256 prefix/suffix of genres.ts", () => {
    const digest = createHash('sha256').update(read("src/genres.ts"), 'utf8').digest('hex');
    expect(digest.startsWith("aa626817")).toBe(true);
    expect(digest.endsWith("839d914e")).toBe(true);
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks charCodeAt sum of genres.ts", () => {
    const sum = [...read("src/genres.ts")].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(90942);
  });

  it("locks LF-only no BOM no tabs for genres.ts", () => {
    const src = read("src/genres.ts");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.includes('\t')).toBe(false);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks first four char codes of genres.ts", () => {
    expect([...read("src/genres.ts").slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([47,42,42,32]);
  });

  it("locks Buffer.from equals TextEncoder for genres.ts", () => {
    const src = read("src/genres.ts");
    expect([...Buffer.from(src, 'utf8')]).toEqual([...new TextEncoder().encode(src)]);
  });

  it("locks sha256 of mcp.ts", () => {
    const src = read("src/mcp.ts");
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it("locks sha1 of mcp.ts", () => {
    expect(createHash('sha1').update(read("src/mcp.ts"), 'utf8').digest('hex')).toBe("848b3977365809fda54fcb74a7d09affe685ea82");
  });

  it("locks md5 of mcp.ts", () => {
    expect(createHash('md5').update(read("src/mcp.ts"), 'utf8').digest('hex')).toBe("52e71c72e32e3d95b8b8d61ff4a2cf46");
  });

  it("locks UTF-8 byte length of mcp.ts via TextEncoder and fs.statSync", () => {
    const src = read("src/mcp.ts");
    expect(new TextEncoder().encode(src).length).toBe(2057);
    expect(statSync(join(root, "src/mcp.ts")).size).toBe(2057);
    expect(Buffer.byteLength(src, 'utf8')).toBe(2057);
  });

  it("locks char length and split line count of mcp.ts", () => {
    const src = read("src/mcp.ts");
    expect(src.length).toBe(2057);
    expect(src.split('\n').length).toBe(68);
    expect(src.split('\n').filter((l) => l.length > 0).length).toBe(67);
    expect((src.match(/\n/g) ?? []).length).toBe(67);
  });

  it("locks sha256 prefix/suffix of mcp.ts", () => {
    const digest = createHash('sha256').update(read("src/mcp.ts"), 'utf8').digest('hex');
    expect(digest.startsWith("6ae8ffd7")).toBe(true);
    expect(digest.endsWith("b3099683")).toBe(true);
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks charCodeAt sum of mcp.ts", () => {
    const sum = [...read("src/mcp.ts")].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(155333);
  });

  it("locks LF-only no BOM no tabs for mcp.ts", () => {
    const src = read("src/mcp.ts");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.includes('\t')).toBe(false);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks first four char codes of mcp.ts", () => {
    expect([...read("src/mcp.ts").slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([101,120,112,111]);
  });

  it("locks Buffer.from equals TextEncoder for mcp.ts", () => {
    const src = read("src/mcp.ts");
    expect([...Buffer.from(src, 'utf8')]).toEqual([...new TextEncoder().encode(src)]);
  });

  it("locks sha256 of types.ts", () => {
    const src = read("src/types.ts");
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe("4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3");
  });

  it("locks sha1 of types.ts", () => {
    expect(createHash('sha1').update(read("src/types.ts"), 'utf8').digest('hex')).toBe("1e8906673dc0d140ee5c3d40839c88a1eeca03d8");
  });

  it("locks md5 of types.ts", () => {
    expect(createHash('md5').update(read("src/types.ts"), 'utf8').digest('hex')).toBe("ecba663d21928622be656805ad27d0a3");
  });

  it("locks UTF-8 byte length of types.ts via TextEncoder and fs.statSync", () => {
    const src = read("src/types.ts");
    expect(new TextEncoder().encode(src).length).toBe(174);
    expect(statSync(join(root, "src/types.ts")).size).toBe(174);
    expect(Buffer.byteLength(src, 'utf8')).toBe(174);
  });

  it("locks char length and split line count of types.ts", () => {
    const src = read("src/types.ts");
    expect(src.length).toBe(172);
    expect(src.split('\n').length).toBe(7);
    expect(src.split('\n').filter((l) => l.length > 0).length).toBe(6);
    expect((src.match(/\n/g) ?? []).length).toBe(6);
  });

  it("locks sha256 prefix/suffix of types.ts", () => {
    const digest = createHash('sha256').update(read("src/types.ts"), 'utf8').digest('hex');
    expect(digest.startsWith("4008ddd3")).toBe(true);
    expect(digest.endsWith("26f743d3")).toBe(true);
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("locks charCodeAt sum of types.ts", () => {
    const sum = [...read("src/types.ts")].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(21759);
  });

  it("locks LF-only no BOM no tabs for types.ts", () => {
    const src = read("src/types.ts");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.includes('\t')).toBe(false);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks first four char codes of types.ts", () => {
    expect([...read("src/types.ts").slice(0, 4)].map((c) => c.charCodeAt(0))).toEqual([101,120,112,111]);
  });

  it("locks Buffer.from equals TextEncoder for types.ts", () => {
    const src = read("src/types.ts");
    expect([...Buffer.from(src, 'utf8')]).toEqual([...new TextEncoder().encode(src)]);
  });

  it("locks src/ directory inventory to five TypeScript modules", () => {
    const files = readdirSync(join(root, 'src')).sort();
    expect(files).toEqual(['genres.ts', 'index.ts', 'mcp.ts', 'parser.ts', 'types.ts']);
    expect(files).toHaveLength(5);
    expect(files.every((f) => f.endsWith('.ts'))).toBe(true);
  });

  it("locks src tree free of .js .jsx .tsx .mjs companions", () => {
    const files = readdirSync(join(root, 'src'));
    expect(files.some((f) => /\.(js|jsx|tsx|mjs|cjs)$/.test(f))).toBe(false);
  });

  it("cross-locks combined src sha256 of concatenation order index→parser→genres→mcp→types", () => {
    const blob = ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']
      .map((f) => read(f))
      .join('\0');
    expect(createHash('sha256').update(blob, 'utf8').digest('hex')).toBe("6686c4834fa76438ca42ae8fc3a1e0b1f7f8271edf6c5914a4b08a9f9feaa2a4");
  });

  it("locks total src UTF-8 byte budget across five modules", () => {
    const total = ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']
      .map((f) => statSync(join(root, f)).size)
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(9951);
  });

  it("locks index import block order and count", () => {
    const imports = read('src/index.ts').split('\n').filter((l) => l.startsWith('import '));
    expect(imports).toEqual([
      "import { Hono } from 'hono';",
      "import { cors } from 'hono/cors';",
      "import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres';",
      "import { parseM3U, Station } from './parser';",
      "import { Env } from './types';",
    ]);
    expect(imports).toHaveLength(5);
  });

  it("locks index fetch call count to three (primary + music fallback + Gemini)", () => {
    expect([...read('src/index.ts').matchAll(/\bfetch\(/g)]).toHaveLength(3);
  });

  it("locks index c.json response builder count", () => {
    expect([...read('src/index.ts').matchAll(/c\.json\(/g)]).toHaveLength(8);
  });

  it("locks index await keyword count", () => {
    expect([...read('src/index.ts').matchAll(/\bawait\s+/g)]).toHaveLength(10);
  });

  it("locks index try/catch pair counts for catalog + Gemini paths", () => {
    expect([...read('src/index.ts').matchAll(/\btry\s*\{/g)]).toHaveLength(3);
    expect([...read('src/index.ts').matchAll(/\bcatch\s*\{/g)]).toHaveLength(3);
  });

  it("locks index backtick template literal delimiter count", () => {
    expect([...read('src/index.ts').matchAll(/`/g)]).toHaveLength(14);
  });

  it("locks index crab emoji code point and single occurrence", () => {
    const index = read('src/index.ts');
    expect([...index].filter((c) => c === '\u{1F980}')).toHaveLength(1);
    expect('\u{1F980}'.codePointAt(0)).toBe(0x1f980);
    expect(index).toContain("powered_by: 'Backlink/Geryon \u{1F980}'");
  });

  it("locks index em-dash code point in station list format line", () => {
    const index = read('src/index.ts');
    expect([...index].filter((c) => c === '\u{2014}').length).toBeGreaterThanOrEqual(1);
    expect('\u{2014}'.codePointAt(0)).toBe(0x2014);
    expect(index).toContain('] \u{2014} ');
  });

  it("locks index free of Anthropic Claude OpenAI Azure Bedrock vendors", () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/anthropic|claude|openai|azure|bedrock|cohere|mistral/i);
  });

  it("locks index free of console.log debug leftovers", () => {
    expect(read('src/index.ts')).not.toMatch(/console\.(log|debug|info|warn|error)\(/);
  });

  it("locks index free of process.env Node bindings", () => {
    expect(read('src/index.ts')).not.toContain('process.env');
    expect(read('src/index.ts')).not.toMatch(/\bprocess\./);
  });

  it("locks index free of Deno Bun Node runtime imports", () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/from\s+['"]node:/);
    expect(index).not.toMatch(/from\s+['"]bun:/);
    expect(index).not.toMatch(/from\s+['"]deno:/);
  });

  it("locks index free of middleware beyond single cors use", () => {
    const index = read('src/index.ts');
    expect([...index.matchAll(/app\.use\(/g)]).toHaveLength(1);
    expect(index).toContain("app.use('*', cors())");
  });

  it("locks index free of streaming SSE WebSocket upgrade", () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/text\/event-stream|EventSource|websocket/i);
  });

  it("locks index free of Authorization Bearer header construction", () => {
    expect(read('src/index.ts')).not.toMatch(/Authorization|Bearer /);
  });

  it("locks index Gemini key only as query param not header", () => {
    const index = read('src/index.ts');
    expect(index).toContain('generateContent?key=');
    expect(index).toContain('${apiKey}');
    expect(index).not.toMatch(/x-goog-api-key/i);
  });

  it("locks index stationList numbering starts at i + 1", () => {
    expect(read('src/index.ts')).toContain('${i + 1}. ${s.name}');
  });

  it("locks index export default app as final non-empty statement", () => {
    const nonempty = read('src/index.ts').split('\n').filter((l) => l.trim().length > 0);
    expect(nonempty.at(-1)).toBe('export default app;');
  });

  it("locks index IPTV_BASE appears exactly once as const", () => {
    expect([...read('src/index.ts').matchAll(/const IPTV_BASE = /g)]).toHaveLength(1);
    expect([...read('src/index.ts').matchAll(/IPTV_BASE/g)].length).toBeGreaterThanOrEqual(3);
  });

  it("locks index cacheKey stations:genre template exactly once", () => {
    expect([...read('src/index.ts').matchAll(/stations:\$\{genre\}/g)]).toHaveLength(1);
  });

  it("locks index kv.get then kv.put order in fetchStations", () => {
    const index = read('src/index.ts');
    const getAt = index.indexOf('await kv.get(cacheKey)');
    const putAt = index.indexOf('await kv.put(cacheKey');
    expect(getAt).toBeGreaterThan(-1);
    expect(putAt).toBeGreaterThan(getAt);
  });

  it("locks index JSON.parse cached stations cast as Station[]", () => {
    expect(read('src/index.ts')).toContain('return JSON.parse(cached) as Station[]');
  });

  it("locks index JSON.stringify stations for kv.put", () => {
    expect(read('src/index.ts')).toContain('JSON.stringify(stations)');
  });

  it("locks index new Date().toISOString timestamp on /curate", () => {
    expect(read('src/index.ts')).toContain('timestamp: new Date().toISOString()');
  });

  it("locks index /genres spreads VALID_GENRES into array", () => {
    expect(read('src/index.ts')).toContain('genres: [...VALID_GENRES]');
    expect(read('src/index.ts')).toContain('aliases: GENRE_MAP');
  });

  it("locks index /stations query genreParam then resolveGenre", () => {
    const block = read('src/index.ts').slice(
      read('src/index.ts').indexOf("app.get('/stations'"),
      read('src/index.ts').indexOf("app.get('/curate'"),
    );
    expect(block).toContain("const genreParam = c.req.query('genre')");
    expect(block).toContain('const genre = resolveGenre(genreParam)');
    expect(block).not.toContain("c.req.query('mood')");
  });

  it("locks index /curate reads genre and mood query params", () => {
    const block = read('src/index.ts').slice(read('src/index.ts').indexOf("app.get('/curate'"));
    expect(block).toContain("const genreParam = c.req.query('genre')");
    expect(block).toContain("const mood = c.req.query('mood')");
    expect(block).toContain('const genre = resolveGenre(genreParam ?? mood)');
  });

  it("locks index graceful degradation map keeps logo and null editorial", () => {
    const index = read('src/index.ts');
    expect(index).toContain('editorial: null');
    expect(index).toContain('logo: s.logo');
    expect(index).toContain('url: s.url');
    expect(index).toContain('name: s.name');
  });

  it("locks index callGemini return type array of editorial objects", () => {
    expect(read('src/index.ts')).toContain(
      'Promise<Array<{ name: string; url: string; logo?: string; editorial: string; genre: string }>>',
    );
  });

  it("locks index contents parts text prompt shape for Gemini body", () => {
    expect(read('src/index.ts')).toContain('contents: [{ parts: [{ text: prompt }] }]');
  });

  it("locks index free of rate-limit Redis or DO counters", () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/redis|ratelimit|rate_limit|DurableObject/i);
  });

  it("locks index free of html/jsx/css response helpers", () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/c\.html\(|c\.text\(|text\/html|application\/xml/);
  });

  it("locks index free of zod yup joi validation libs", () => {
    expect(read('src/index.ts')).not.toMatch(/from\s+['"]zod['"]|from\s+['"]yup['"]|from\s+['"]joi['"]/);
  });

  it("locks parser arrow unicode free; only em-dash non-ascii", () => {
    const parser = read('src/parser.ts');
    const nonAscii = [...parser].filter((c) => (c.codePointAt(0) ?? 0) > 127);
    expect(nonAscii).toHaveLength(1);
    expect(nonAscii[0]).toBe('\u{2014}');
  });

  it("locks parser startsWith http and https exactly once each pattern", () => {
    const parser = read('src/parser.ts');
    expect([...parser.matchAll(/startsWith\('http:\/\/'\)/g)]).toHaveLength(1);
    expect([...parser.matchAll(/startsWith\('https:\/\/'\)/g)]).toHaveLength(1);
  });

  it("locks parser regex extractors case-insensitive flag", () => {
    const parser = read('src/parser.ts');
    expect([...parser.matchAll(/\/i\)/g)].length).toBeGreaterThanOrEqual(5);
    expect(parser).toContain('/tvg-name="([^"]*)"/i');
    expect(parser).toContain('/tvg-logo="([^"]*)"/i');
    expect(parser).toContain('/group-title="([^"]*)"/i');
    expect(parser).toContain('/tvg-language="([^"]*)"/i');
    expect(parser).toContain('/tvg-country="([^"]*)"/i');
  });

  it("locks parser lastIndexOf comma fallback for display name", () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain("const commaIdx = line.lastIndexOf(',')");
    expect(parser).toContain('line.slice(commaIdx + 1).trim()');
  });

  it("locks parser free of fetch network and DOMParser", () => {
    const parser = read('src/parser.ts');
    expect(parser).not.toMatch(/\bfetch\s*\(/);
    expect(parser).not.toMatch(/DOMParser|XMLHttpRequest/);
  });

  it("locks parser free of default export", () => {
    expect(read('src/parser.ts')).not.toMatch(/export\s+default/);
  });

  it("locks parser Station interface before parseM3U function", () => {
    const parser = read('src/parser.ts');
    expect(parser.indexOf('export interface Station')).toBeLessThan(parser.indexOf('export function parseM3U'));
  });

  it("locks parser current reset occurs on EXTINF http and non-http branches", () => {
    expect([...read('src/parser.ts').matchAll(/current = \{\}/g)]).toHaveLength(4);
  });

  it("locks parser seen.add(line) before stations.push", () => {
    const parser = read('src/parser.ts');
    expect(parser.indexOf('seen.add(line)')).toBeLessThan(parser.indexOf('stations.push'));
  });

  it("locks genres arrow unicode single occurrence in file header comment", () => {
    const genres = read('src/genres.ts');
    const nonAscii = [...genres].filter((c) => (c.codePointAt(0) ?? 0) > 127);
    expect(nonAscii).toHaveLength(1);
    expect(nonAscii[0]).toBe('\u{2192}');
    expect(genres).toContain('mood aliases \u{2192} category');
  });

  it("locks genres GENRE_MAP key count 21 and value set subset of VALID_GENRES", () => {
    const keys = Object.keys(GENRE_MAP);
    expect(keys).toHaveLength(21);
    for (const v of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES.includes(v as (typeof VALID_GENRES)[number])).toBe(true);
    }
  });

  it("locks genres source lists late night as first GENRE_MAP key", () => {
    expect(read('src/genres.ts')).toMatch(/GENRE_MAP[\s\S]*?'late night':\s*'ambient'/);
    const mapBlock = read('src/genres.ts').slice(
      read('src/genres.ts').indexOf('export const GENRE_MAP'),
      read('src/genres.ts').indexOf('export const VALID_GENRES'),
    );
    expect(mapBlock.indexOf("'late night'")).toBeLessThan(mapBlock.indexOf('chill:'));
  });

  it("locks genres resolveGenre uses VALID_GENRES.includes with ValidGenre cast", () => {
    expect(read('src/genres.ts')).toContain(
      'return map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : \'music\')',
    );
  });

  it("locks genres free of network and console", () => {
    const genres = read('src/genres.ts');
    expect(genres).not.toMatch(/\bfetch\s*\(/);
    expect(genres).not.toMatch(/console\./);
  });

  it("locks genres ValidGenre type export precedes resolveGenre", () => {
    const genres = read('src/genres.ts');
    expect(genres.indexOf('export type ValidGenre')).toBeLessThan(genres.indexOf('export function resolveGenre'));
  });

  it("locks mcp.ts is pure ASCII", () => {
    const mcp = read('src/mcp.ts');
    expect([...mcp].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(mcp.codePointAt(0)).toBe(mcp.charCodeAt(0));
  });

  it("locks mcp double-quote style for JSON-like string literals", () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('schema_version: "v1"');
    expect(mcp).not.toContain("schema_version: 'v1'");
  });

  it("locks mcp tool name tokens exactly once each", () => {
    const mcp = read('src/mcp.ts');
    expect([...mcp.matchAll(/name: "station_select"/g)]).toHaveLength(1);
    expect([...mcp.matchAll(/name: "now_playing"/g)]).toHaveLength(1);
    expect([...mcp.matchAll(/name: "genre_filter"/g)]).toHaveLength(1);
    expect([...mcp.matchAll(/name: "curator_prompt"/g)]).toHaveLength(1);
  });

  it("locks mcp tool order station_select → now_playing → genre_filter → curator_prompt", () => {
    const mcp = read('src/mcp.ts');
    const a = mcp.indexOf('name: "station_select"');
    const b = mcp.indexOf('name: "now_playing"');
    const c = mcp.indexOf('name: "genre_filter"');
    const d = mcp.indexOf('name: "curator_prompt"');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
  });

  it("locks mcp free of fetch and Hono imports", () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).not.toMatch(/^import /m);
    expect(mcp).not.toMatch(/\bfetch\s*\(/);
    expect(mcp).not.toContain('hono');
  });

  it("locks mcp export const MCP_MANIFEST as sole export", () => {
    expect([...read('src/mcp.ts').matchAll(/^export /gm)]).toHaveLength(1);
    expect(read('src/mcp.ts')).toMatch(/^export const MCP_MANIFEST = \{/m);
  });

  it("locks mcp ends with closing brace semicolon", () => {
    expect(read('src/mcp.ts').trimEnd().endsWith('};')).toBe(true);
  });

  it("locks types.ts em-dash single non-ascii in JSDoc comment", () => {
    const types = read('src/types.ts');
    const nonAscii = [...types].filter((c) => (c.codePointAt(0) ?? 0) > 127);
    expect(nonAscii).toHaveLength(1);
    expect(nonAscii[0]).toBe('\u{2014}');
  });

  it("locks types.ts exact source text", () => {
    expect(read('src/types.ts')).toBe("export interface Env {\n  CATALOG_CACHE: KVNamespace;\n  /** Optional at runtime — `/curate` returns 503 when unset (#8). */\n  GEMINI_API_KEY?: string;\n  VERSION?: string;\n}\n");
  });

  it("locks types.ts references issue #8 in GEMINI optional comment", () => {
    expect(read('src/types.ts')).toContain('#8');
    expect(read('src/types.ts')).toContain('/curate');
    expect(read('src/types.ts')).toContain('503');
  });

  it("locks types.ts free of import statements", () => {
    expect(read('src/types.ts')).not.toMatch(/^import /m);
  });

  it("locks sha256 of DEPLOY.md", () => {
    expect(createHash('sha256').update(read("DEPLOY.md"), 'utf8').digest('hex')).toBe("11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a");
  });

  it("locks md5 of DEPLOY.md", () => {
    expect(createHash('md5').update(read("DEPLOY.md"), 'utf8').digest('hex')).toBe("da30bf656fdf0d9a61d2a00860c325f5");
  });

  it("locks byte/char/line budgets of DEPLOY.md", () => {
    const src = read("DEPLOY.md");
    expect(new TextEncoder().encode(src).length).toBe(1573);
    expect(src.length).toBe(1539);
    expect(src.split('\n').length).toBe(65);
    expect(statSync(join(root, "DEPLOY.md")).size).toBe(1573);
  });

  it("locks LF-only no BOM for DEPLOY.md", () => {
    const src = read("DEPLOY.md");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks sha256 of AGENTS.md", () => {
    expect(createHash('sha256').update(read("AGENTS.md"), 'utf8').digest('hex')).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("locks md5 of AGENTS.md", () => {
    expect(createHash('md5').update(read("AGENTS.md"), 'utf8').digest('hex')).toBe("e73be0edb8c4353b6b591454478f00cd");
  });

  it("locks byte/char/line budgets of AGENTS.md", () => {
    const src = read("AGENTS.md");
    expect(new TextEncoder().encode(src).length).toBe(1017);
    expect(src.length).toBe(1011);
    expect(src.split('\n').length).toBe(35);
    expect(statSync(join(root, "AGENTS.md")).size).toBe(1017);
  });

  it("locks LF-only no BOM for AGENTS.md", () => {
    const src = read("AGENTS.md");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks sha256 of README.md", () => {
    expect(createHash('sha256').update(read("README.md"), 'utf8').digest('hex')).toBe("f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987");
  });

  it("locks md5 of README.md", () => {
    expect(createHash('md5').update(read("README.md"), 'utf8').digest('hex')).toBe("9b7aea4982a6d68b95f7f8ee3fdc5b31");
  });

  it("locks byte/char/line budgets of README.md", () => {
    const src = read("README.md");
    expect(new TextEncoder().encode(src).length).toBe(2801);
    expect(src.length).toBe(2757);
    expect(src.split('\n').length).toBe(82);
    expect(statSync(join(root, "README.md")).size).toBe(2801);
  });

  it("locks LF-only no BOM for README.md", () => {
    const src = read("README.md");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks sha256 of docs/mcp-spec.md", () => {
    expect(createHash('sha256').update(read("docs/mcp-spec.md"), 'utf8').digest('hex')).toBe("a93978d779b976a1aba4d34395eec7628b21bda910ef8a279d5efbc05da56849");
  });

  it("locks md5 of docs/mcp-spec.md", () => {
    expect(createHash('md5').update(read("docs/mcp-spec.md"), 'utf8').digest('hex')).toBe("ee7881030c338c1773659cc6378c392c");
  });

  it("locks byte/char/line budgets of docs/mcp-spec.md", () => {
    const src = read("docs/mcp-spec.md");
    expect(new TextEncoder().encode(src).length).toBe(3552);
    expect(src.length).toBe(3544);
    expect(src.split('\n').length).toBe(145);
    expect(statSync(join(root, "docs/mcp-spec.md")).size).toBe(3552);
  });

  it("locks LF-only no BOM for docs/mcp-spec.md", () => {
    const src = read("docs/mcp-spec.md");
    expect(src.includes('\r')).toBe(false);
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.endsWith('\n')).toBe(true);
  });

  it("locks .cursor/environment.json exact digests and shape", () => {
    const env = read('.cursor/environment.json');
    expect(createHash('sha256').update(env, 'utf8').digest('hex')).toBe("4ed3537a1a4141c61be528b8ca3bd121164ab2bed7d0a9b95c34ce81cca99694");
    expect(createHash('md5').update(env, 'utf8').digest('hex')).toBe("956c8804543595a31d6a7051aecd6528");
    expect(env.length).toBe(57);
    expect(JSON.parse(env)).toEqual({ name: 'Backlink_Facelift', install: 'npm ci' });
  });

  it("cross-locks package.json name with wrangler.toml and MCP name_for_model", () => {
    const pkg = JSON.parse(read('package.json')) as { name: string };
    expect(pkg.name).toBe('backlink');
    expect(read('wrangler.toml')).toContain('name = "backlink"');
    expect(read('src/mcp.ts')).toContain('name_for_model: "backlink"');
    expect(read('src/index.ts')).toContain("name: 'Backlink'");
  });

  it("cross-locks package version with wrangler VERSION and index fallback", () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe('0.1.0');
    expect(read('wrangler.toml')).toContain('VERSION = "0.1.0"');
    expect([...read('src/index.ts').matchAll(/c\.env\.VERSION \?\? '0\.1\.0'/g)]).toHaveLength(2);
  });

  it("cross-locks AGENTS.md Safe Agent Actions with src module paths", () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('src/genres.ts');
    expect(agents).toContain('src/index.ts');
    expect(agents).toContain('src/parser.ts');
    expect(agents).toContain('test/');
  });

  it("cross-locks AGENTS.md Verify block with package.json scripts", () => {
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

  it("cross-locks AGENTS.md escalate GEMINI with types optional key and DEPLOY secret", () => {
    expect(read('AGENTS.md')).toContain('GEMINI_API_KEY');
    expect(read('src/types.ts')).toContain('GEMINI_API_KEY?: string');
    expect(read('DEPLOY.md')).toContain('wrangler secret put GEMINI_API_KEY');
    expect(read('wrangler.toml')).toContain('wrangler secret put GEMINI_API_KEY');
  });

  it("cross-locks AGENTS.md domain target with wrangler route pattern", () => {
    expect(read('AGENTS.md')).toContain('backlink.fuzzywigg.com');
    expect(read('wrangler.toml')).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(read('DEPLOY.md')).toContain('backlink.fuzzywigg.com');
    expect(read('README.md')).toContain('https://backlink.fuzzywigg.com');
    expect(read('src/index.ts')).not.toContain('backlink.fuzzywigg.com');
  });

  it("cross-locks DEPLOY.md Gemini 2.0 Flash with index model id", () => {
    expect(read('DEPLOY.md')).toContain('Gemini 2.0 Flash');
    expect(read('src/index.ts')).toContain('gemini-2.0-flash');
    expect(read('README.md')).toContain('Gemini 2.0 Flash');
  });

  it("cross-locks DEPLOY.md CATALOG_CACHE with types and wrangler binding", () => {
    expect(read('DEPLOY.md')).toContain('CATALOG_CACHE');
    expect(read('src/types.ts')).toContain('CATALOG_CACHE: KVNamespace');
    expect(read('wrangler.toml')).toContain('binding = "CATALOG_CACHE"');
    expect(read('src/index.ts')).toContain('c.env.CATALOG_CACHE');
  });

  it("cross-locks README API examples with registered Worker routes", () => {
    const readme = read('README.md');
    const index = read('src/index.ts');
    for (const route of ['/curate', '/stations', '/genres', '/health']) {
      expect(readme).toContain(route);
      expect(index).toContain("app.get('" + route + "'");
    }
  });

  it("cross-locks README curated_by example with index curated_by field", () => {
    expect(read('README.md')).toContain('"curated_by": "Backlink/Geryon"');
    expect(read('src/index.ts')).toContain("curated_by: 'Backlink/Geryon'");
  });

  it("cross-locks README Available Genres list with VALID_GENRES order", () => {
    const readme = read('README.md');
    const joined = [...VALID_GENRES].join(' · ');
    expect(readme).toContain(joined);
  });

  it("cross-locks README aliases chill lofi blues with GENRE_MAP", () => {
    const readme = read('README.md');
    expect(readme).toContain('chill');
    expect(readme).toContain('lofi');
    expect(readme).toContain('blues');
    expect(GENRE_MAP.chill).toBe('ambient');
    expect(GENRE_MAP.lofi).toBe('ambient');
    expect(GENRE_MAP.blues).toBe('jazz');
  });

  it("cross-locks docs/mcp-spec tool headings with MCP_MANIFEST tool count mismatch acknowledged", () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec).toContain('### `backlink_curate`');
    expect(spec).toContain('### `backlink_genres`');
    expect(spec).toContain('### `backlink_now_playing`');
    expect(read('src/mcp.ts')).toContain('name: "curator_prompt"');
    expect(read('src/mcp.ts')).toContain('name: "genre_filter"');
    expect(read('src/mcp.ts')).toContain('name: "now_playing"');
  });

  it("cross-locks mcp-spec Endpoint /curate with index route registration", () => {
    expect(read('docs/mcp-spec.md')).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(read('src/index.ts')).toContain("app.get('/curate'");
  });

  it("locks AGENTS.md Tier A Autonomy L2 classification", () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Tier: A');
    expect(agents).toContain('Autonomy: L2');
    expect(agents).toContain('parent_governance: github.com/fuzzywigg/agents-governance');
  });

  it("locks AGENTS.md escalate CORS and billing bullets", () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('Changes to CORS or authentication logic');
    expect(agents).toContain('Any billing or CF account configuration');
    expect(agents).toContain('Adding new external data sources beyond iptv-org');
  });

  it("locks DEPLOY.md HITL Andrew review first production deploy", () => {
    expect(read('DEPLOY.md')).toContain('First production deploy must be reviewed by Andrew');
    expect(read('DEPLOY.md')).toContain('HITL Required');
  });

  it("locks DEPLOY.md local dev localhost:8787 documentation only", () => {
    expect(read('DEPLOY.md')).toContain('http://localhost:8787');
    expect(read('src/index.ts')).not.toContain('localhost');
    expect(read('src/index.ts')).not.toContain('8787');
  });

  it("locks DEPLOY.md free of committed API key material", () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(deploy).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
  });

  it("locks README CI badge points at Backlink_Facelift ci.yml", () => {
    expect(read('README.md')).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml/badge.svg',
    );
  });

  it("locks README Stack bullets Cloudflare Workers Hono iptv-org Gemini CF KV", () => {
    const readme = read('README.md');
    expect(readme).toContain('Cloudflare Workers');
    expect(readme).toContain('Hono');
    expect(readme).toContain('iptv-org');
    expect(readme).toContain('Gemini 2.0 Flash');
    expect(readme).toContain('CF KV');
    expect(readme).toContain('1h TTL');
  });

  it("locks README notes jazz/ambient category 404 fallback behavior", () => {
    const readme = read('README.md');
    expect(readme).toContain('music.m3u');
    expect(readme).toContain('editorial: null');
    expect(readme).toMatch(/404/);
  });

  it("locks index and parser share Station type only from parser module", () => {
    expect(read('src/index.ts')).toContain("import { parseM3U, Station } from './parser'");
    expect(read('src/types.ts')).not.toContain('Station');
    expect(read('src/genres.ts')).not.toContain('Station');
    expect(read('src/mcp.ts')).not.toContain('Station');
  });

  it("locks no circular imports among src modules via static from paths", () => {
    const index = read('src/index.ts');
    const parser = read('src/parser.ts');
    const genres = read('src/genres.ts');
    const mcp = read('src/mcp.ts');
    const types = read('src/types.ts');
    expect(parser).not.toMatch(/from\s+['"]\.\//);
    expect(genres).not.toMatch(/from\s+['"]\.\//);
    expect(mcp).not.toMatch(/from\s+['"]\.\//);
    expect(types).not.toMatch(/from\s+['"]\.\//);
    expect(index).toMatch(/from\s+['"]\.\/genres['"]/);
    expect(index).toMatch(/from\s+['"]\.\/parser['"]/);
    expect(index).toMatch(/from\s+['"]\.\/types['"]/);
    expect(index).not.toMatch(/from\s+['"]\.\/mcp['"]/);
  });

  it("locks src files free of @ts-ignore @ts-expect-error and eslint-disable", () => {
    for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      const src = read(f);
      expect(src).not.toMatch(/@ts-ignore|@ts-expect-error|eslint-disable/);
    }
  });

  it("locks src files free of debugger statements", () => {
    for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(read(f)).not.toMatch(/\bdebugger\b/);
    }
  });

  it("locks src files free of base64 blob literals longer than 40", () => {
    for (const f of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(read(f)).not.toMatch(/[A-Za-z0-9+\/]{40,}={0,2}/);
    }
  });

  it("locks index prompt Be specific about what makes each station right for the mood", () => {
    expect(read('src/index.ts')).toContain(
      'Be specific about what makes each station right for the mood.',
    );
  });

  it("locks index prompt short editorial blurb 1-2 sentences max", () => {
    expect(read('src/index.ts')).toContain('short editorial blurb (1-2 sentences max)');
  });

  it("locks index JSON schema example keys name url logo editorial genre", () => {
    expect(read('src/index.ts')).toContain(
      '[{"name": "...", "url": "...", "logo": "...", "editorial": "...", "genre": "..."}]',
    );
  });

  it("locks index group ?? genre and language ?? en coalescing in stationList", () => {
    expect(read('src/index.ts')).toContain('s.group ?? genre');
    expect(read('src/index.ts')).toContain("s.language ?? 'en'");
  });

  it("locks index free of second Gemini model fallback ids", () => {
    const index = read('src/index.ts');
    expect(index).not.toContain('gemini-1.5');
    expect(index).not.toContain('gemini-pro');
    expect(index).not.toContain('gemini-2.5');
    expect([...index.matchAll(/gemini-2\.0-flash/g)]).toHaveLength(1);
  });

  it("locks index v1beta models path exactly once", () => {
    expect([...read('src/index.ts').matchAll(/v1beta\/models/g)]).toHaveLength(1);
  });

  it("locks index generativelanguage.googleapis.com host exactly once", () => {
    expect([...read('src/index.ts').matchAll(/generativelanguage\.googleapis\.com/g)]).toHaveLength(1);
  });

  it("locks index iptv-org.github.io host exactly once via IPTV_BASE", () => {
    expect([...read('src/index.ts').matchAll(/iptv-org\.github\.io/g)]).toHaveLength(1);
  });

  it("locks index free of hard-coded station URLs", () => {
    expect(read('src/index.ts')).not.toMatch(/https:\/\/(?!iptv-org\.github\.io|generativelanguage\.googleapis\.com)[^'"`\s]+/);
  });

  it("locks parser free of hard-coded example.com fixtures", () => {
    expect(read('src/parser.ts')).not.toContain('example.com');
    expect(read('src/parser.ts')).not.toContain('http://');
    expect(read('src/parser.ts')).toContain("startsWith('http://')");
  });

  it("locks genres map values never invent playlist or now-playing categories", () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(v).not.toMatch(/playlist|now-playing|openapi/i);
    }
    expect(VALID_GENRES).not.toContain('playlist' as never);
  });

  it("locks MCP auth none and no oauth client fields", () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('auth: { type: "none" }');
    expect(mcp).not.toMatch(/oauth|client_id|client_secret|api_key_header/i);
  });

  it("locks MCP description_for_human iptv-org catalog wording", () => {
    expect(read('src/mcp.ts')).toContain(
      'description_for_human: "AI-curated live radio from the iptv-org catalog."',
    );
  });

  it("locks environment.json install is exactly npm ci with no extra flags", () => {
    const env = JSON.parse(read('.cursor/environment.json')) as { install: string };
    expect(env.install).toBe('npm ci');
    expect(env.install).not.toContain('--');
    expect(env.install.split(/\s+/)).toEqual(['npm', 'ci']);
  });

  it("locks package.json type module for ESM Worker", () => {
    const pkg = JSON.parse(read('package.json')) as { type: string };
    expect(pkg.type).toBe('module');
  });

  it("locks package.json sole runtime dependency hono", () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
  });

  it("locks package.json description mentions iptv-org catalog", () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
    expect(read('src/index.ts')).toContain("description: '" + pkg.description + "'");
  });

  it("locks createHash sha256 digest Buffer length 32 for index.ts", () => {
    expect(createHash('sha256').update(read('src/index.ts'), 'utf8').digest()).toHaveLength(32);
  });

  it("locks createHash md5 digest Buffer length 16 for parser.ts", () => {
    expect(createHash('md5').update(read('src/parser.ts'), 'utf8').digest()).toHaveLength(16);
  });

  it("locks createHash sha1 digest Buffer length 20 for genres.ts", () => {
    expect(createHash('sha1').update(read('src/genres.ts'), 'utf8').digest()).toHaveLength(20);
  });

  it("locks second TextEncoder pass identical for mcp.ts", () => {
    const src = read('src/mcp.ts');
    const a = new TextEncoder().encode(src);
    const b = new TextEncoder().encode(src);
    expect([...a]).toEqual([...b]);
    expect(a.length).toBe(2057);
  });

  it("locks types.ts lean under 200 UTF-8 bytes", () => {
    expect(statSync(join(root, 'src/types.ts')).size).toBeLessThan(200);
    expect(statSync(join(root, 'src/types.ts')).size).toBe(174);
  });

  it("locks genres.ts under 1100 UTF-8 bytes", () => {
    expect(statSync(join(root, 'src/genres.ts')).size).toBe(1027);
    expect(statSync(join(root, 'src/genres.ts')).size).toBeLessThan(1100);
  });

  it("locks parser.ts under 2000 UTF-8 bytes", () => {
    expect(statSync(join(root, 'src/parser.ts')).size).toBe(1955);
    expect(statSync(join(root, 'src/parser.ts')).size).toBeLessThan(2000);
  });

  it("locks mcp.ts under 2100 UTF-8 bytes", () => {
    expect(statSync(join(root, 'src/mcp.ts')).size).toBe(2057);
    expect(statSync(join(root, 'src/mcp.ts')).size).toBeLessThan(2100);
  });

  it("locks index.ts under 4800 UTF-8 bytes", () => {
    expect(statSync(join(root, 'src/index.ts')).size).toBe(4738);
    expect(statSync(join(root, 'src/index.ts')).size).toBeLessThan(4800);
  });

  it("locks codePointAt sequence for IPTV_BASE host", () => {
    expect([...('iptv-org.github.io')].map((c) => c.charCodeAt(0))).toEqual([105,112,116,118,45,111,114,103,46,103,105,116,104,117,98,46,105,111]);
  });

  it("locks codePointAt sequence for Gemini host", () => {
    expect([...('generativelanguage.googleapis.com')].map((c) => c.charCodeAt(0))).toEqual([103,101,110,101,114,97,116,105,118,101,108,97,110,103,117,97,103,101,46,103,111,111,103,108,101,97,112,105,115,46,99,111,109]);
  });

  it("locks TextEncoder bytes for CATALOG_CACHE binding token", () => {
    expect([...new TextEncoder().encode('CATALOG_CACHE')]).toEqual([67,65,84,65,76,79,71,95,67,65,67,72,69]);
  });

  it("locks TextEncoder bytes for GEMINI_API_KEY token", () => {
    expect([...new TextEncoder().encode('GEMINI_API_KEY')]).toEqual([71,69,77,73,78,73,95,65,80,73,95,75,69,89]);
  });

  it("locks TextEncoder bytes for MCP_MANIFEST export name", () => {
    expect([...new TextEncoder().encode('MCP_MANIFEST')]).toEqual([77,67,80,95,77,65,78,73,70,69,83,84]);
  });

  it("locks index app.get path string char codes for /health", () => {
    expect([...('/health')].map((c) => c.charCodeAt(0))).toEqual([47, 104, 101, 97, 108, 116, 104]);
  });

  it("locks index app.get path string char codes for /curate", () => {
    expect([...('/curate')].map((c) => c.charCodeAt(0))).toEqual([47, 99, 117, 114, 97, 116, 101]);
  });

  it("locks index app.get path string char codes for /stations", () => {
    expect([...('/stations')].map((c) => c.charCodeAt(0))).toEqual([47,115,116,97,116,105,111,110,115]);
  });

  it("locks index app.get path string char codes for /genres", () => {
    expect([...('/genres')].map((c) => c.charCodeAt(0))).toEqual([47,103,101,110,114,101,115]);
  });

  it("locks resolveGenre default music char codes", () => {
    expect([...('music')].map((c) => c.charCodeAt(0))).toEqual([109, 117, 115, 105, 99]);
    expect(read('src/genres.ts')).toContain("return 'music'");
  });

  it("locks parseM3U function name char codes", () => {
    expect([...('parseM3U')].map((c) => c.charCodeAt(0))).toEqual([112,97,114,115,101,77,51,85]);
  });

  it("locks Backlink product name char codes in index root payload", () => {
    expect([...('Backlink')].map((c) => c.charCodeAt(0))).toEqual([66,97,99,107,108,105,110,107]);
    expect(read('src/index.ts')).toContain("name: 'Backlink'");
  });

  it("locks Geryon curated_by token char codes", () => {
    expect([...('Backlink/Geryon')].map((c) => c.charCodeAt(0))).toEqual([66,97,99,107,108,105,110,107,47,71,101,114,121,111,110]);
  });

  it("locks expirationTtl 3600 digit char codes", () => {
    expect([...('3600')].map((c) => c.charCodeAt(0))).toEqual([51, 54, 48, 48]);
    expect(read('src/index.ts')).toContain('expirationTtl: 3600');
  });

  it("locks maxOutputTokens 512 digit char codes", () => {
    expect([...('512')].map((c) => c.charCodeAt(0))).toEqual([53, 49, 50]);
  });

  it("locks temperature 0.7 digit char codes", () => {
    expect([...('0.7')].map((c) => c.charCodeAt(0))).toEqual([48, 46, 55]);
  });

  it("locks retry_after 60 digit char codes", () => {
    expect([...('60')].map((c) => c.charCodeAt(0))).toEqual([54, 48]);
    expect([...read('src/index.ts').matchAll(/retry_after:\s*60/g)]).toHaveLength(3);
  });

  it("locks AGENTS.md free of API keys and account ids", () => {
    const agents = read('AGENTS.md');
    expect(agents).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(agents).not.toMatch(/edb6ca4df12f4f45b40508b3dda3c432/);
  });

  it("locks README free of wrangler KV id embedding", () => {
    expect(read('README.md')).not.toContain('edb6ca4df12f4f45b40508b3dda3c432');
  });

  it("locks docs/mcp-spec free of GEMINI_API_KEY literal", () => {
    expect(read('docs/mcp-spec.md')).not.toContain('GEMINI_API_KEY');
  });

  it("locks all src files use single quotes for JS string literals in index imports", () => {
    expect(read('src/index.ts')).toContain("from 'hono'");
    expect(read('src/index.ts')).toContain("from 'hono/cors'");
    expect(read('src/index.ts')).toContain("from './genres'");
  });

  it("locks mcp.ts uses double quotes exclusively for manifest string values", () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/"[a-zA-Z]/);
    expect(mcp).not.toMatch(/:\s*'[^']+'/);
  });

  it("locks index semicolon statement style (no ASI-only free functions)", () => {
    expect(read('src/index.ts')).toContain('export default app;');
    expect(read('src/index.ts')).toContain("app.use('*', cors());");
  });

  it("locks parser uses two-space indent not four", () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(/^  name: string;/m);
    expect(parser).not.toMatch(/^    name: string;/m);
  });

  it("locks genres uses two-space indent for map entries", () => {
    expect(read('src/genres.ts')).toMatch(/^  chill: 'ambient',/m);
  });

  it("locks types uses two-space indent for Env fields", () => {
    expect(read('src/types.ts')).toMatch(/^  CATALOG_CACHE: KVNamespace;/m);
  });

  it("locks index fetchStations and callGemini are async function declarations", () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/async function fetchStations\(/);
    expect(index).toMatch(/async function callGemini\(/);
    expect(index).not.toMatch(/const fetchStations\s*=/);
    expect(index).not.toMatch(/const callGemini\s*=/);
  });

  it("locks index Hono app const precedes route registration", () => {
    const index = read('src/index.ts');
    expect(index.indexOf('const app = new Hono')).toBeLessThan(index.indexOf("app.use('*', cors())"));
    expect(index.indexOf("app.use('*', cors())")).toBeLessThan(index.indexOf("app.get('/',"));
  });

  it("locks index callGemini defined before const app", () => {
    const index = read('src/index.ts');
    expect(index.indexOf('async function callGemini')).toBeLessThan(index.indexOf('const app = new Hono'));
    expect(index.indexOf('async function fetchStations')).toBeLessThan(index.indexOf('async function callGemini'));
  });

  it("locks index IPTV_BASE defined before fetchStations", () => {
    const index = read('src/index.ts');
    expect(index.indexOf('const IPTV_BASE')).toBeLessThan(index.indexOf('async function fetchStations'));
  });

  it("locks types.ts exact line inventory", () => {
    expect(read('src/types.ts').split('\n')).toEqual([
      "export interface Env {",
      "  CATALOG_CACHE: KVNamespace;",
      "  /** Optional at runtime — `/curate` returns 503 when unset (#8). */",
      "  GEMINI_API_KEY?: string;",
      "  VERSION?: string;",
      "}",
      "",
    ]);
  });

  it("locks environment.json exact line inventory", () => {
    expect(read('.cursor/environment.json').split('\n')).toEqual([
      "{",
      "  \"name\": \"Backlink_Facelift\",",
      "  \"install\": \"npm ci\"",
      "}",
      "",
    ]);
  });

  it("locks wrangler.toml sha256 still aligned with source-contract domain expectations", () => {
    expect(createHash('sha256').update(read('wrangler.toml'), 'utf8').digest('hex')).toBe("95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8");
  });

  it("locks package.json sha256 for description/version contract stability", () => {
    expect(createHash('sha256').update(read('package.json'), 'utf8').digest('hex')).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("locks VALID_GENRES lexicographic order is not alphabetical (music first)", () => {
    const alpha = [...VALID_GENRES].sort((a, b) => a.localeCompare(b));
    expect([...VALID_GENRES]).not.toEqual(alpha);
    expect(VALID_GENRES[0]).toBe('music');
  });

  it("locks GENRE_MAP key insertion order starts with late night", () => {
    expect(Object.keys(GENRE_MAP)[0]).toBe('late night');
    expect(Object.keys(GENRE_MAP).at(-1)).toBe('lo-fi');
  });

  it("locks src file names sort lexicographically genres index mcp parser types", () => {
    expect(readdirSync(join(root, 'src')).sort((a, b) => a.localeCompare(b))).toEqual([
      'genres.ts',
      'index.ts',
      'mcp.ts',
      'parser.ts',
      'types.ts',
    ]);
  });

  it("locks index free of // TODO-style product invent comments", () => {
    expect(read('src/index.ts')).not.toMatch(/\bTODO\b|\bFIXME\b|\bHACK\b/);
  });

  it("locks parser comment documents Non-http URL rtmp skip", () => {
    expect(read('src/parser.ts')).toContain('Non-http URL (rtmp://, etc.)');
  });

  it("locks index comment documents Fallback to music.m3u", () => {
    expect(read('src/index.ts')).toContain('// Fallback to music.m3u');
  });

  it("locks index comment documents Graceful degradation top 5", () => {
    expect(read('src/index.ts')).toContain('// Graceful degradation: return top 5 without editorial');
  });

  it("locks types JSDoc Optional at runtime /curate 503", () => {
    expect(read('src/types.ts')).toContain('Optional at runtime');
    expect(read('src/types.ts')).toContain('returns 503 when unset');
  });

  it("locks sha256 of index differs from parser genres mcp types", () => {
    const digests = ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts'].map((f) =>
      createHash('sha256').update(read(f), 'utf8').digest('hex'),
    );
    expect(new Set(digests).size).toBe(5);
  });

  it("locks md5 of docs files are unique across DEPLOY AGENTS README mcp-spec", () => {
    const digests = ['DEPLOY.md', 'AGENTS.md', 'README.md', 'docs/mcp-spec.md'].map((f) =>
      createHash('md5').update(read(f), 'utf8').digest('hex'),
    );
    expect(new Set(digests).size).toBe(4);
  });

  it("locks index String length less than UTF-8 bytes due to multi-byte emoji/dash", () => {
    const src = read('src/index.ts');
    expect(src.length).toBe(4724);
    expect(Buffer.byteLength(src, 'utf8')).toBe(4738);
    expect(Buffer.byteLength(src, 'utf8')).toBeGreaterThan(src.length);
  });

  it("locks mcp String length equals UTF-8 bytes (ASCII-only)", () => {
    const src = read('src/mcp.ts');
    expect(src.length).toBe(Buffer.byteLength(src, 'utf8'));
    expect(src.length).toBe(2057);
  });

  it("locks genres String length less than UTF-8 bytes due to arrow", () => {
    const src = read('src/genres.ts');
    expect(Buffer.byteLength(src, 'utf8') - src.length).toBe(2); // U+2192 is 3 bytes → +2
  });

  it("locks parser String length less than UTF-8 bytes due to em-dash", () => {
    const src = read('src/parser.ts');
    expect(Buffer.byteLength(src, 'utf8') - src.length).toBe(2); // U+2014 is 3 bytes → +2
  });

  it("locks types String length less than UTF-8 bytes due to em-dash", () => {
    const src = read('src/types.ts');
    expect(Buffer.byteLength(src, 'utf8') - src.length).toBe(2);
  });
});
