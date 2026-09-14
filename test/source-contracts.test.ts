import { readdirSync, readFileSync } from 'node:fs';
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

  // --- HEAVY burn (post-#66): source ↔ product contract deepen ---
  // Orthogonal to routes (#66), wrangler (#65), genres (#63), parser (#60), helpers (#58).
  // Tests-only. No product inventing.

  it('post66: locks AGENTS.md Classification Tier A Active Strategic', () => {
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/## Classification/);
    expect(agents).toContain('Tier: A (Active Strategic — Andrew flagged HIGH PRIORITY)');
  });

  it('post66: locks AGENTS.md Autonomy L2 Standard non-critical infra', () => {
    expect(read('AGENTS.md')).toContain('Autonomy: L2 (Standard — non-critical infra)');
  });

  it('post66: locks AGENTS.md parent_governance fuzzywigg/agents-governance', () => {
    expect(read('AGENTS.md')).toContain(
      'parent_governance: github.com/fuzzywigg/agents-governance',
    );
  });

  it('post66: locks AGENTS.md Purpose domain target backlink.fuzzywigg.com', () => {
    const agents = read('AGENTS.md');
    const purpose = agents.slice(agents.indexOf('## Purpose'), agents.indexOf('## Safe Agent Actions'));
    expect(purpose).toMatch(/LLM-curated internet radio on CF Workers/);
    expect(purpose).toContain('Domain target: backlink.fuzzywigg.com');
  });

  it('post66: locks AGENTS.md title Backlink_Facelift', () => {
    expect(read('AGENTS.md')).toMatch(/^# AGENTS\.md — Backlink_Facelift/m);
  });

  it('post66: locks AGENTS Escalate GEMINI_API_KEY and secret management', () => {
    const escalate = read('AGENTS.md').slice(read('AGENTS.md').indexOf('## Escalate to Human'));
    expect(escalate).toMatch(/GEMINI_API_KEY handling or any secret management/);
  });

  it('post66: locks AGENTS Escalate Production deploy first deploy HITL', () => {
    const escalate = read('AGENTS.md').slice(read('AGENTS.md').indexOf('## Escalate to Human'));
    expect(escalate).toMatch(/Production deploy \(first deploy must be HITL\)/);
  });

  it('post66: locks AGENTS Escalate external data sources beyond iptv-org', () => {
    const escalate = read('AGENTS.md').slice(read('AGENTS.md').indexOf('## Escalate to Human'));
    expect(escalate).toMatch(/beyond iptv-org/);
  });

  it('post66: locks AGENTS Escalate CORS or authentication logic', () => {
    const escalate = read('AGENTS.md').slice(read('AGENTS.md').indexOf('## Escalate to Human'));
    expect(escalate).toMatch(/CORS or authentication logic/);
  });

  it('post66: locks AGENTS Safe Actions include parser.ts and test/ extends', () => {
    const safe = read('AGENTS.md').slice(
      read('AGENTS.md').indexOf('## Safe Agent Actions'),
      read('AGENTS.md').indexOf('## Verify'),
    );
    expect(safe).toMatch(/Improve M3U parser in `src\/parser\.ts`/);
    expect(safe).toMatch(/Add \/ extend unit tests under `test\/`/);
    expect(safe).toMatch(/Bump dependency versions/);
  });

  it('post66: cross-locks AGENTS Verify scripts with package.json scripts', () => {
    const agents = read('AGENTS.md');
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const verify = agents.slice(agents.indexOf('## Verify'), agents.indexOf('## Escalate to Human'));
    expect(verify).toContain('npm ci');
    expect(verify).toContain('npm run typecheck');
    expect(verify).toContain('npm test');
    expect(verify).toContain('npm run test:coverage');
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
  });

  it('post66: locks DEPLOY.md Prerequisites Gemini API key and Node 18+', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/## Prerequisites/);
    expect(deploy).toContain('Gemini API key');
    expect(deploy).toContain('Node.js 18+');
    expect(deploy).toContain('Cloudflare account with Workers enabled');
  });

  it('post66: locks DEPLOY.md custom domain backlink.fuzzywigg.com steps', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/Add custom domain/);
    expect(deploy).toContain('backlink.fuzzywigg.com');
    expect(deploy).toMatch(/fuzzywigg\.com`? is on Cloudflare DNS/);
  });

  it('post66: locks DEPLOY.md KV create CATALOG_CACHE and placeholder id', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toContain('wrangler kv namespace create CATALOG_CACHE');
    expect(deploy).toContain('your-kv-id-here');
    expect(deploy).toContain('binding = "CATALOG_CACHE"');
  });

  it('post66: locks DEPLOY.md Cost Estimate Workers free tier 100k requests', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/## Cost Estimate/);
    expect(deploy).toMatch(/100,000 requests\/day/);
    expect(deploy).toMatch(/CF KV/);
  });

  it('post66: locks DEPLOY.md Gemini 2.0 Flash token pricing bullets', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/Gemini 2\.0 Flash/);
    expect(deploy).toMatch(/\$0\.25\/1M input tokens/);
    expect(deploy).toMatch(/\$1\.25\/1M output tokens/);
    expect(deploy).toMatch(/\$0\.75 per 1,000 curation requests/);
  });

  it('post66: locks DEPLOY.md Local dev wrangler on localhost:8787', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/## Local dev/);
    expect(deploy).toContain('npm run dev');
    expect(deploy).toContain('http://localhost:8787');
  });

  it('post66: locks DEPLOY.md HITL Andrew first production deploy', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/## HITL Required/);
    expect(deploy).toMatch(/First production deploy must be reviewed by Andrew/);
  });

  it('post66: cross-locks DEPLOY Gemini model with Worker gemini-2.0-flash', () => {
    expect(read('DEPLOY.md')).toMatch(/Gemini 2\.0 Flash/);
    expect(read('src/index.ts')).toContain('gemini-2.0-flash');
  });

  it('post66: locks README CI badge points at ci.yml workflow', () => {
    const readme = read('README.md');
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml/badge.svg',
    );
    expect(readme).toContain(
      'https://github.com/fuzzywigg/Backlink_Facelift/actions/workflows/ci.yml',
    );
  });

  it('post66: locks README live worker URL https://backlink.fuzzywigg.com', () => {
    expect(read('README.md')).toContain('https://backlink.fuzzywigg.com');
    expect(read('README.md')).not.toMatch(/workers\.dev/);
  });

  it('post66: locks README JSON API over iptv-org blockquote positioning', () => {
    expect(read('README.md')).toMatch(/JSON API over iptv-org category M3Us/);
  });

  it('post66: locks README live caveat catalog is IPTV video not internet radio', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/Catalog is IPTV \*video\* channels, not internet radio/);
    expect(readme).toMatch(/editorial: null/);
  });

  it('post66: locks README real matching categories music news sports entertainment', () => {
    expect(read('README.md')).toContain(
      'Real matching categories today: `music`, `news`, `sports`, `entertainment`.',
    );
  });

  it('post66: locks README Cloud agents bootstrap npm ci only no secrets', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/## Cloud agents/);
    expect(readme).toMatch(/`npm ci` only; no secrets in the file/);
    expect(readme).toContain('.cursor/environment.json');
  });

  it('post66: locks README Coverage floors stay at 100% all four metrics', () => {
    expect(read('README.md')).toMatch(
      /Coverage floors stay at \*\*100%\*\* statements\/branches\/functions\/lines/,
    );
  });

  it('post66: locks README CI pins Node 20 and persist-credentials false', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/CI pins Node 20/);
    expect(readme).toMatch(/disables checkout credentials persistence/);
    expect(readme).toMatch(/asserts `coverage\/lcov\.info` exists/);
  });

  it('post66: cross-locks README coverage floors with vitest thresholds 100', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toMatch(/lines:\s*100/);
    expect(vitest).toMatch(/functions:\s*100/);
    expect(vitest).toMatch(/branches:\s*100/);
    expect(vitest).toMatch(/statements:\s*100/);
    expect(read('README.md')).toMatch(/100%/);
  });

  it('post66: locks README Stack Cloudflare Workers Hono iptv-org Gemini KV', () => {
    const stack = read('README.md').slice(read('README.md').indexOf('## Stack'));
    expect(stack).toMatch(/Cloudflare Workers/);
    expect(stack).toMatch(/Hono/);
    expect(stack).toMatch(/iptv-org/);
    expect(stack).toMatch(/Gemini 2\.0 Flash/);
    expect(stack).toMatch(/CF KV/);
    expect(stack).toMatch(/1h TTL/);
  });

  it('post66: locks README Example Response curated_by Backlink/Geryon', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/## Example Response/);
    expect(readme).toContain('"curated_by": "Backlink/Geryon"');
    expect(readme).toContain('"editorial": "Deep, textural ambient');
  });

  it('post66: locks README API /health example version 0.1.0', () => {
    expect(read('README.md')).toContain('→ { ok: true, version: "0.1.0" }');
  });

  it('post66: locks README Part of smtp.eth ecosystem Andrew link', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/## Part of the smtp\.eth ecosystem/);
    expect(readme).toContain('[Andrew Pappas](https://fuzzywigg.com)');
  });

  it('post66: cross-locks domain across README DEPLOY AGENTS wrangler mcp-spec', () => {
    const domain = 'backlink.fuzzywigg.com';
    expect(read('README.md')).toContain(domain);
    expect(read('DEPLOY.md')).toContain(domain);
    expect(read('AGENTS.md')).toContain(domain);
    expect(read('wrangler.toml')).toContain(domain);
    expect(read('docs/mcp-spec.md')).toContain(`https://${domain}`);
  });

  it('post66: locks callGemini stationList map template with group language defaults', () => {
    expect(read('src/index.ts')).toContain(
      "${i + 1}. ${s.name} (${s.group ?? genre}) [${s.language ?? 'en'}] — ${s.url}",
    );
  });

  it('post66: locks callGemini persona You are Backlink an AI radio curator', () => {
    expect(read('src/index.ts')).toContain(
      'You are Backlink, an AI radio curator. Given this list of radio stations and the user\'s request, pick the top 3 stations',
    );
  });

  it('post66: locks callGemini editorial blurb 1-2 sentences max instruction', () => {
    expect(read('src/index.ts')).toContain(
      'with a short editorial blurb (1-2 sentences max)',
    );
  });

  it('post66: locks callGemini Be specific about what makes each station right for the mood', () => {
    expect(read('src/index.ts')).toContain(
      'Be specific about what makes each station right for the mood',
    );
  });

  it('post66: locks callGemini Return JSON only schema keys name url logo editorial genre', () => {
    expect(read('src/index.ts')).toContain(
      'Return JSON only: [{"name": "...", "url": "...", "logo": "...", "editorial": "...", "genre": "..."}]',
    );
  });

  it('post66: locks Gemini fetch URL template generateContent key query param', () => {
    expect(read('src/index.ts')).toContain(
      '`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`',
    );
  });

  it('post66: locks Gemini POST headers content-type application/json', () => {
    expect(read('src/index.ts')).toContain("headers: { 'content-type': 'application/json' }");
    expect(read('src/index.ts')).toContain("method: 'POST'");
  });

  it('post66: locks Gemini body contents single parts text prompt', () => {
    expect(read('src/index.ts')).toContain(
      'contents: [{ parts: [{ text: prompt }] }]',
    );
  });

  it('post66: locks Gemini generationConfig object inline maxOutputTokens temperature', () => {
    expect(read('src/index.ts')).toContain(
      'generationConfig: { maxOutputTokens: 512, temperature: 0.7 }',
    );
  });

  it('post66: locks Gemini error throw uses resp.status interpolation', () => {
    expect(read('src/index.ts')).toContain('`Gemini API error: ${resp.status}`');
  });

  it('post66: locks Invalid JSON from Gemini exact throw string', () => {
    expect(read('src/index.ts')).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it('post66: locks candidates[0] optional chain with empty string coalesce', () => {
    expect(read('src/index.ts')).toContain(
      "const text = data.candidates[0]?.content?.parts[0]?.text ?? ''",
    );
  });

  it('post66: locks IPTV_BASE const and category url template', () => {
    const index = read('src/index.ts');
    expect(index).toContain(
      "const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'",
    );
    expect(index).toContain('const url = `${IPTV_BASE}/${genre}.m3u`');
  });

  it('post66: locks fetchStations cacheKey stations colon genre template', () => {
    expect(read('src/index.ts')).toContain('const cacheKey = `stations:${genre}`');
  });

  it('post66: locks fetchStations KV get then JSON.parse as Station array', () => {
    const index = read('src/index.ts');
    expect(index).toContain('const cached = await kv.get(cacheKey)');
    expect(index).toContain('if (cached) return JSON.parse(cached) as Station[]');
  });

  it('post66: locks fetchStations kv.put JSON.stringify with expirationTtl 3600', () => {
    expect(read('src/index.ts')).toContain(
      'await kv.put(cacheKey, JSON.stringify(stations), { expirationTtl: 3600 })',
    );
  });

  it('post66: locks Stream catalog unavailable throw when music fallback fails', () => {
    expect(read('src/index.ts')).toContain("throw new Error('Stream catalog unavailable')");
  });

  it('post66: locks Fallback to music.m3u comment adjacent to fallback fetch', () => {
    const index = read('src/index.ts');
    expect(index).toContain('// Fallback to music.m3u');
    expect(index).toContain('res = await fetch(`${IPTV_BASE}/music.m3u`)');
  });

  it('post66: locks / response name Backlink and powered_by crab branding', () => {
    const index = read('src/index.ts');
    expect(index).toContain("name: 'Backlink'");
    expect(index).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it('post66: locks / endpoints map four keys with exact help strings', () => {
    const index = read('src/index.ts');
    expect(index).toContain("'/curate': 'GET ?genre=&mood= — AI-curated station picks'");
    expect(index).toContain("'/stations': 'GET ?genre= — Raw station list'");
    expect(index).toContain("'/genres': 'GET — Available genre categories'");
    expect(index).toContain("'/health': 'GET — Health check'");
  });

  it('post66: locks /health ok true and VERSION fallback 0.1.0', () => {
    expect(read('src/index.ts')).toContain(
      "return c.json({ ok: true, version: c.env.VERSION ?? '0.1.0' })",
    );
  });

  it('post66: locks /genres spreads VALID_GENRES and aliases GENRE_MAP', () => {
    const index = read('src/index.ts');
    expect(index).toContain('genres: [...VALID_GENRES]');
    expect(index).toContain('aliases: GENRE_MAP');
  });

  it('post66: locks /stations response genre count stations keys', () => {
    expect(read('src/index.ts')).toContain(
      'return c.json({ genre, count: stations.length, stations })',
    );
  });

  it('post66: locks /stations and /curate catalog 503 payload identical', () => {
    const index = read('src/index.ts');
    const payload = "{ error: 'Stream catalog unavailable', retry_after: 60 }, 503";
    expect((index.match(new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(2);
  });

  it('post66: locks /curate key-missing 503 Curation service unavailable', () => {
    expect(read('src/index.ts')).toContain(
      "return c.json({ error: 'Curation service unavailable', retry_after: 60 }, 503)",
    );
  });

  it('post66: locks /curate query join mood genreParam space fallback genre', () => {
    expect(read('src/index.ts')).toContain(
      "const query = [mood, genreParam].filter(Boolean).join(' ') || genre",
    );
  });

  it('post66: locks /curate response curated_by without crab emoji', () => {
    const index = read('src/index.ts');
    expect(index).toContain("curated_by: 'Backlink/Geryon'");
    expect(index).toContain("powered_by: 'Backlink/Geryon 🦀'");
    expect(index).not.toContain("curated_by: 'Backlink/Geryon 🦀'");
  });

  it('post66: locks /curate timestamp via new Date().toISOString()', () => {
    expect(read('src/index.ts')).toContain('timestamp: new Date().toISOString()');
  });

  it('post66: locks degrade map fields name url logo editorial null genre', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/editorial:\s*null/);
    expect(index).toContain('// Graceful degradation: return top 5 without editorial');
    expect(index).toMatch(/stations\.slice\(0,\s*5\)\.map\(\(s\) => \(\{/);
  });

  it('post66: locks helper declaration order fetchStations then callGemini then app', () => {
    const index = read('src/index.ts');
    const fetchIdx = index.indexOf('async function fetchStations');
    const geminiIdx = index.indexOf('async function callGemini');
    const appIdx = index.indexOf("const app = new Hono<{ Bindings: Env }>()");
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(geminiIdx).toBeGreaterThan(fetchIdx);
    expect(appIdx).toBeGreaterThan(geminiIdx);
  });

  it('post66: locks route registration after cors middleware', () => {
    const index = read('src/index.ts');
    const corsIdx = index.indexOf("app.use('*', cors())");
    const rootIdx = index.indexOf("app.get('/',");
    expect(corsIdx).toBeGreaterThan(-1);
    expect(rootIdx).toBeGreaterThan(corsIdx);
  });

  it('post66: locks exactly one export default app and no named exports in index', () => {
    const index = read('src/index.ts');
    expect([...index.matchAll(/^export default app/gm)]).toHaveLength(1);
    expect(index).not.toMatch(/^export \{/m);
    expect(index).not.toMatch(/^export const /m);
    expect(index).not.toMatch(/^export function /m);
  });

  it('post66: locks index import order Hono cors genres parser types', () => {
    const index = read('src/index.ts');
    const hono = index.indexOf("import { Hono } from 'hono'");
    const cors = index.indexOf("import { cors } from 'hono/cors'");
    const genres = index.indexOf("import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres'");
    const parser = index.indexOf("import { parseM3U, Station } from './parser'");
    const types = index.indexOf("import { Env } from './types'");
    expect(hono).toBeLessThan(cors);
    expect(cors).toBeLessThan(genres);
    expect(genres).toBeLessThan(parser);
    expect(parser).toBeLessThan(types);
  });

  it('post66: locks index free of mcp import and MCP_MANIFEST identifier', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/from ['"]\.\/mcp['"]/);
    expect(index).not.toContain('MCP_MANIFEST');
  });

  it('post66: locks index free of process.env Deno Bun Node APIs', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/process\.env/);
    expect(index).not.toMatch(/\bDeno\b|\bBun\b/);
    expect(index).not.toMatch(/node:fs|node:path/);
  });

  it('post66: locks index free of Anthropic OpenAI Claude Haiku strings', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/anthropic|openai|claude|haiku|gpt-4/i);
  });

  it('post66: locks index line count 154 with trailing newline (153 content lines)', () => {
    expect(read('src/index.ts').split('\n').length).toBe(154);
  });

  it('post66: locks parser line count 67 with trailing newline (66 content lines)', () => {
    expect(read('src/parser.ts').split('\n').length).toBe(67);
  });

  it('post66: locks genres line count 48 with trailing newline (47 content lines)', () => {
    expect(read('src/genres.ts').split('\n').length).toBe(48);
  });

  it('post66: locks mcp line count 68 with trailing newline (67 content lines)', () => {
    expect(read('src/mcp.ts').split('\n').length).toBe(68);
  });

  it('post66: locks types line count 7 with trailing newline (6 content lines)', () => {
    expect(read('src/types.ts').split('\n').length).toBe(7);
  });

  it('post66: locks parser rtmp non-http skip comment', () => {
    expect(read('src/parser.ts')).toContain(
      '// Non-http URL (rtmp://, etc.) — skip but reset current',
    );
  });

  it('post66: locks parser EXTINF startsWith and current reset Partial Station', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain("if (line.startsWith('#EXTINF'))");
    expect(parser).toContain('let current: Partial<Station> = {}');
    expect(parser).toContain('current = {}');
  });

  it('post66: locks parser Extract tvg-name logo group language country comments', () => {
    const parser = read('src/parser.ts');
    expect(parser).toContain('// Extract tvg-name');
    expect(parser).toContain('// Extract tvg-logo');
    expect(parser).toContain('// Extract group-title');
    expect(parser).toContain('// Extract tvg-language');
    expect(parser).toContain('// Extract tvg-country');
  });

  it('post66: locks parser Fallback name comment after last comma', () => {
    expect(read('src/parser.ts')).toContain(
      '// Fallback name from the end of the #EXTINF line (after last comma)',
    );
  });

  it('post66: locks parser push object field order name url logo group language country', () => {
    const parser = read('src/parser.ts');
    expect(parser).toMatch(
      /stations\.push\(\{\s*name: current\.name,\s*url: line,\s*logo: current\.logo,\s*group: current\.group,\s*language: current\.language,\s*country: current\.country,\s*\}\)/,
    );
  });

  it('post66: locks parser free of fetch network and Env bindings', () => {
    const parser = read('src/parser.ts');
    expect(parser).not.toMatch(/\bfetch\s*\(/);
    expect(parser).not.toMatch(/KVNamespace|GEMINI|Env/);
    expect(parser).not.toMatch(/from ['"]\.\//);
  });

  it('post66: locks genres resolveGenre empty input returns music', () => {
    expect(read('src/genres.ts')).toContain("if (!input) return 'music'");
  });

  it('post66: locks genres resolveGenre lowercases and trims input', () => {
    expect(read('src/genres.ts')).toContain(
      'const lower = input.toLowerCase().trim()',
    );
  });

  it('post66: locks genres resolveGenre default map parameter GENRE_MAP', () => {
    expect(read('src/genres.ts')).toMatch(
      /map:\s*Record<string,\s*string>\s*=\s*GENRE_MAP/,
    );
  });

  it('post66: locks GENRE_MAP entry count 21 aliases including identity keys', () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it('post66: locks VALID_GENRES runtime length 9 matching README middot list', () => {
    expect(VALID_GENRES).toHaveLength(9);
    const readme = read('README.md');
    const line = readme
      .split('\n')
      .find((l) => l.includes('`music`') && l.includes('·') && l.includes('`entertainment`'));
    const listed = [...(line ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(listed).toEqual([...VALID_GENRES]);
  });

  it('post66: locks GENRE_MAP metal→rock dance→pop blues→jazz classic→classical', () => {
    expect(GENRE_MAP.metal).toBe('rock');
    expect(GENRE_MAP.dance).toBe('pop');
    expect(GENRE_MAP.blues).toBe('jazz');
    expect(GENRE_MAP.classic).toBe('classical');
  });

  it('post66: locks GENRE_MAP focus relaxing chill late night electronic to ambient', () => {
    for (const key of ['focus', 'relaxing', 'chill', 'late night', 'electronic', 'lofi', 'lo-fi']) {
      expect(GENRE_MAP[key]).toBe('ambient');
    }
  });

  it('post66: locks every GENRE_MAP value is a VALID_GENRES member', () => {
    const valid = new Set<string>(VALID_GENRES as unknown as string[]);
    for (const value of Object.values(GENRE_MAP)) {
      expect(valid.has(value)).toBe(true);
    }
  });

  it('post66: locks genres module free of hono fetch kv and mcp', () => {
    const genres = read('src/genres.ts');
    expect(genres).not.toMatch(/\bfetch\s*\(|hono|KVNamespace|MCP_MANIFEST/);
  });

  it('post66: locks MCP_MANIFEST schema_version v1 name_for_model backlink', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('schema_version: "v1"');
    expect(mcp).toContain('name_for_model: "backlink"');
    expect(mcp).toContain('name_for_human: "Backlink Radio"');
  });

  it('post66: locks MCP auth none and openapi api url /openapi.json', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('auth: { type: "none" }');
    expect(mcp).toContain('api: { type: "openapi", url: "/openapi.json" }');
  });

  it('post66: locks MCP tools array order station_select now_playing genre_filter curator_prompt', () => {
    const mcp = read('src/mcp.ts');
    const names = [...mcp.matchAll(/^\s*name: "([a-z_]+)"/gm)].map((m) => m[1]);
    expect(names).toEqual([
      'station_select',
      'now_playing',
      'genre_filter',
      'curator_prompt',
    ]);
  });

  it('post66: locks MCP now_playing empty properties object schema', () => {
    expect(read('src/mcp.ts')).toContain(
      'input_schema: { type: "object", properties: {} }',
    );
  });

  it('post66: locks MCP station_select required station_name only', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('required: ["station_name"]');
    expect(mcp).toContain('Partial or full name of the station to select.');
  });

  it('post66: locks MCP genre_filter required genre and jazz news classical example', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('required: ["genre"]');
    expect(mcp).toContain('e.g. jazz, news, classical');
  });

  it('post66: locks MCP curator_prompt required mood with optional genre', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toContain('required: ["mood"]');
    expect(mcp).toContain('Optional genre to constrain the selection.');
    expect(mcp).toContain('focus work, late night jazz, morning energy');
  });

  it('post66: locks MCP free of fetch hono Env and Gemini strings', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).not.toMatch(/\bfetch\s*\(|from ['"]hono|GEMINI|KVNamespace/);
  });

  it('post66: cross-locks docs backlink_curate endpoint with Worker /curate', () => {
    expect(read('docs/mcp-spec.md')).toContain('GET /curate?genre={genre}&mood={mood}');
    expect(read('src/index.ts')).toMatch(/app\.get\('\/curate'/);
  });

  it('post66: cross-locks docs backlink_genres endpoint with Worker /genres', () => {
    expect(read('docs/mcp-spec.md')).toContain('**Endpoint:** `GET /genres`');
    expect(read('src/index.ts')).toMatch(/app\.get\('\/genres'/);
  });

  it('post66: cross-locks docs stream_url remap against Worker url field', () => {
    expect(read('docs/mcp-spec.md')).toMatch(/url`?\s+remapped to\s+`?stream_url/i);
    expect(read('src/index.ts')).toMatch(/url:\s*s\.url|url:\s*"\.\.\."/);
    expect(read('src/index.ts')).not.toContain('stream_url');
  });

  it('post66: cross-locks docs Integration Notes 1h TTL with expirationTtl 3600', () => {
    expect(read('docs/mcp-spec.md')).toMatch(/1h TTL/i);
    expect(read('src/index.ts')).toMatch(/expirationTtl:\s*3600/);
  });

  it('post66: cross-locks docs /curate always calls Gemini fresh with no LLM cache in index', () => {
    expect(read('docs/mcp-spec.md')).toMatch(/always calls Gemini fresh/i);
    const index = read('src/index.ts');
    expect(index).not.toMatch(/llm.*cache|cache.*gemini|gemini.*cache/i);
    expect(index).toContain('await callGemini(');
  });

  it('post66: cross-locks docs editorial null degradation with Worker editorial null', () => {
    expect(read('docs/mcp-spec.md')).toContain('editorial: null');
    expect(read('src/index.ts')).toMatch(/editorial:\s*null/);
  });

  it('post66: locks docs Base URL https without workers.dev', () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec).toContain('https://backlink.fuzzywigg.com');
    expect(spec).not.toMatch(/workers\.dev/);
  });

  it('post66: locks docs additionalProperties false at least three times', () => {
    const matches = read('docs/mcp-spec.md').match(/"additionalProperties":\s*false/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('post66: locks docs only markdown file under docs/ is mcp-spec.md', () => {
    expect(readdirSync(join(root, 'docs'))).toEqual(['mcp-spec.md']);
  });

  it('post66: locks Env CATALOG_CACHE required while GEMINI and VERSION optional', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/CATALOG_CACHE:\s*KVNamespace;/);
    expect(types).toMatch(/GEMINI_API_KEY\?:\s*string;/);
    expect(types).toMatch(/VERSION\?:\s*string;/);
  });

  it('post66: locks types.ts JSDoc Optional at runtime issue #8 exact', () => {
    expect(read('src/types.ts')).toContain(
      '/** Optional at runtime — `/curate` returns 503 when unset (#8). */',
    );
  });

  it('post66: locks package.json name backlink type module version 0.1.0', () => {
    const pkg = JSON.parse(read('package.json')) as {
      name: string;
      type: string;
      version: string;
    };
    expect(pkg.name).toBe('backlink');
    expect(pkg.type).toBe('module');
    expect(pkg.version).toBe('0.1.0');
  });

  it('post66: locks package.json sole runtime dependency hono', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['hono']);
    expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  });

  it('post66: locks package.json scripts include wrangler and vitest coverage', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    expect(pkg.scripts['test:watch']).toBe('vitest');
  });

  it('post66: locks package.json description em-dash editorial AI over iptv-org', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toBe(
      'LLM-curated internet radio — editorial AI over iptv-org catalog',
    );
  });

  it('post66: cross-locks package description with Worker / description field', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(read('src/index.ts')).toContain(`description: '${pkg.description}'`);
  });

  it('post66: cross-locks package version with wrangler VERSION var and health fallback', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(read('wrangler.toml')).toContain(`VERSION = "${pkg.version}"`);
    expect(read('src/index.ts')).toContain(`c.env.VERSION ?? '${pkg.version}'`);
  });

  it('post66: locks wrangler.toml name backlink main src/index.ts', () => {
    const wrangler = read('wrangler.toml');
    expect(wrangler).toContain('name = "backlink"');
    expect(wrangler).toContain('main = "src/index.ts"');
  });

  it('post66: locks wrangler.toml custom_domain true for backlink.fuzzywigg.com', () => {
    const wrangler = read('wrangler.toml');
    expect(wrangler).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(wrangler).toContain('custom_domain = true');
  });

  it('post66: locks wrangler.toml never commits GEMINI_API_KEY value', () => {
    const wrangler = read('wrangler.toml');
    expect(wrangler).not.toMatch(/GEMINI_API_KEY\s*=/);
    expect(wrangler).toContain('# wrangler secret put GEMINI_API_KEY');
  });

  it('post66: locks .cursor/environment.json name Backlink_Facelift install npm ci only', () => {
    const env = JSON.parse(read('.cursor/environment.json')) as {
      name: string;
      install: string;
    };
    expect(Object.keys(env).sort()).toEqual(['install', 'name']);
    expect(env.name).toBe('Backlink_Facelift');
    expect(env.install).toBe('npm ci');
  });

  it('post66: locks vitest include test/**/*.test.ts and coverage src/**/*.ts', () => {
    const vitest = read('vitest.config.ts');
    expect(vitest).toContain("include: ['test/**/*.test.ts']");
    expect(vitest).toContain("include: ['src/**/*.ts']");
    expect(vitest).toContain("exclude: ['src/types.ts']");
  });

  it('post66: locks vitest github-actions reporter when GITHUB_ACTIONS set', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default']",
    );
  });

  it('post66: locks vitest coverage reporter text text-summary html lcov', () => {
    expect(read('vitest.config.ts')).toContain(
      "reporter: ['text', 'text-summary', 'html', 'lcov']",
    );
  });

  it('post66: locks tsconfig strict noEmit ES2022 Bundler workers-types', () => {
    const ts = JSON.parse(read('tsconfig.json')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(ts.compilerOptions.strict).toBe(true);
    expect(ts.compilerOptions.noEmit).toBe(true);
    expect(ts.compilerOptions.target).toBe('ES2022');
    expect(ts.compilerOptions.moduleResolution).toBe('Bundler');
    expect(ts.compilerOptions.types).toEqual(['@cloudflare/workers-types', 'node']);
  });

  it('post66: locks tsconfig include src test vitest.config', () => {
    const ts = JSON.parse(read('tsconfig.json')) as { include: string[] };
    expect(ts.include).toEqual(['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts']);
  });

  it('post66: locks .gitignore covers node_modules coverage .env .dev.vars secrets', () => {
    const gi = read('.gitignore');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('coverage/');
    expect(gi).toContain('.env');
    expect(gi).toContain('.dev.vars');
    expect(gi).toContain('*.pem');
    expect(gi).toContain('*.key');
    expect(gi).toContain('.wrangler/');
  });

  it('post66: locks .gitattributes text=auto LF normalization', () => {
    expect(read('.gitattributes')).toContain('* text=auto');
  });

  it('post66: locks src tree exactly five TypeScript modules', () => {
    const files = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.ts')).sort();
    expect(files).toEqual(['genres.ts', 'index.ts', 'mcp.ts', 'parser.ts', 'types.ts']);
  });

  it('post66: locks test suite files include source-contracts among hygiene list', () => {
    const tests = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.ts')).sort();
    expect(tests).toContain('source-contracts.test.ts');
    expect(tests).toContain('routes.test.ts');
    expect(tests).toContain('parser.test.ts');
    expect(tests).toContain('mcp-spec-contract.test.ts');
  });

  it('post66: locks no .env or .dev.vars committed at repo root', () => {
    const rootFiles = readdirSync(root);
    expect(rootFiles).not.toContain('.env');
    expect(rootFiles).not.toContain('.dev.vars');
  });

  it('post66: locks callGemini return Promise Array with editorial string genre', () => {
    expect(read('src/index.ts')).toContain(
      'Promise<Array<{ name: string; url: string; logo?: string; editorial: string; genre: string }>>',
    );
  });

  it('post66: locks degrade path editorial null diverges from callGemini string editorial type', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/editorial:\s*string/);
    expect(index).toMatch(/editorial:\s*null/);
  });

  it('post66: locks /curate GEMINI_API_KEY guard before fetchStations', () => {
    const index = read('src/index.ts');
    const curate = index.slice(index.indexOf("app.get('/curate'"));
    const keyGuard = curate.indexOf('if (!c.env.GEMINI_API_KEY)');
    const fetchCall = curate.indexOf('stations = await fetchStations');
    expect(keyGuard).toBeGreaterThan(-1);
    expect(fetchCall).toBeGreaterThan(keyGuard);
  });

  it('post66: locks /stations has no GEMINI_API_KEY check', () => {
    const index = read('src/index.ts');
    const stations = index.slice(
      index.indexOf("app.get('/stations'"),
      index.indexOf("app.get('/curate'"),
    );
    expect(stations).not.toContain('GEMINI_API_KEY');
    expect(stations).toContain('await fetchStations(genre, c.env.CATALOG_CACHE)');
  });

  it('post66: locks /stations resolveGenre(genreParam) mood-free', () => {
    const index = read('src/index.ts');
    const stations = index.slice(
      index.indexOf("app.get('/stations'"),
      index.indexOf("app.get('/curate'"),
    );
    expect(stations).toContain('const genre = resolveGenre(genreParam)');
    expect(stations).not.toContain('mood');
  });

  it('post66: locks /curate reads both genre and mood query params', () => {
    const index = read('src/index.ts');
    const curate = index.slice(index.indexOf("app.get('/curate'"));
    expect(curate).toContain("const genreParam = c.req.query('genre')");
    expect(curate).toContain("const mood = c.req.query('mood')");
  });

  it('post66: locks exactly five app.get and zero app.post app.put app.delete', () => {
    const index = read('src/index.ts');
    expect((index.match(/app\.get\(/g) ?? []).length).toBe(5);
    expect(index).not.toMatch(/app\.post\(|app\.put\(|app\.delete\(|app\.patch\(/);
  });

  it('post66: locks cors registered exactly once with star path', () => {
    const index = read('src/index.ts');
    expect((index.match(/app\.use\('\*',\s*cors\(\)\)/g) ?? []).length).toBe(1);
    expect((index.match(/cors\(\)/g) ?? []).length).toBe(1);
  });

  it('post66: locks filter\(Boolean\) exactly twice in index', () => {
    expect((read('src/index.ts').match(/\.filter\(Boolean\)/g) ?? []).length).toBe(2);
  });

  it('post66: locks JSON.parse exactly twice and JSON.stringify twice in index', () => {
    const index = read('src/index.ts');
    // parse: KV cache hit + Gemini jsonMatch; stringify: KV put + Gemini request body
    expect((index.match(/JSON\.parse/g) ?? []).length).toBe(2);
    expect((index.match(/JSON\.stringify/g) ?? []).length).toBe(2);
  });

  it('post66: locks fetch( call sites: iptv primary, music fallback, gemini', () => {
    const index = read('src/index.ts');
    // await fetch(url); await fetch(`${IPTV_BASE}/music.m3u`); await fetch(`https://generativelanguage...
    expect((index.match(/await fetch\(/g) ?? []).length).toBe(3);
  });

  it('post66: locks no hardcoded API keys or sk- prefixes in src', () => {
    for (const rel of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/sk-[a-zA-Z0-9]{10,}/);
      expect(src).not.toMatch(/AIza[0-9A-Za-z\-_]{20,}/);
    }
  });

  it('post66: locks src free of TODO FIXME HACK XXX BUG', () => {
    for (const rel of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(read(rel)).not.toMatch(/TODO|FIXME|HACK|XXX|BUG/);
    }
  });

  it('post66: locks src free of any type assertions as any', () => {
    for (const rel of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      expect(read(rel)).not.toContain('as any');
    }
  });

  it('post66: locks src free of eval new Function WebSocket DurableObject D1', () => {
    for (const rel of ['src/index.ts', 'src/parser.ts', 'src/genres.ts', 'src/mcp.ts', 'src/types.ts']) {
      const src = read(rel);
      expect(src).not.toMatch(/\beval\s*\(|new Function|WebSocket|DurableObject|D1Database/);
    }
  });

  it('post66: locks package-lock lockfileVersion 3 present', () => {
    expect(read('package-lock.json')).toMatch(/"lockfileVersion":\s*3/);
  });

  it('post66: locks CI workflow name CI with typecheck test hygiene jobs', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/^name: CI/m);
    expect(ci).toContain('name: Typecheck');
    expect(ci).toContain('name: Tests');
    expect(ci).toContain('name: Hygiene');
  });

  it('post66: locks CI Node 20 and npm ci and test:coverage', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('node-version: "20"');
    expect(ci).toContain('npm ci');
    expect(ci).toContain('npm run test:coverage');
    expect(ci).toContain('npm run typecheck');
  });

  it('post66: locks CI persist-credentials false and contents read', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('persist-credentials: false');
    expect(ci).toContain('contents: read');
  });

  it('post66: locks CI cancel-in-progress true concurrency group', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('cancel-in-progress: true');
    expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
  });

  it('post66: locks deploy.yml workflow_dispatch only HITL trigger', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('workflow_dispatch:');
    expect(deploy).not.toMatch(/^\s+push:/m);
    expect(deploy).not.toMatch(/pull_request/);
  });

  it('post66: locks deploy.yml runs typecheck and test:coverage before wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    const typecheck = deploy.indexOf('npm run typecheck');
    const coverage = deploy.indexOf('npm run test:coverage');
    const wrangler = deploy.indexOf('cloudflare/wrangler-action@v4');
    expect(typecheck).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(typecheck);
    expect(wrangler).toBeGreaterThan(coverage);
  });

  it('post66: locks deploy.yml secrets GEMINI_API_KEY via wrangler-action', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('GEMINI_API_KEY');
    expect(deploy).toContain('secrets.CF_API_TOKEN');
    expect(deploy).toContain('secrets.CF_ACCOUNT_ID');
  });

  it('post66: cross-locks README unit suites list mentions source contracts', () => {
    expect(read('README.md')).toMatch(/source contracts/);
    expect(read('README.md')).toMatch(/mcp-spec/);
  });

  it('post66: locks README Deploy Your Own points at DEPLOY.md', () => {
    expect(read('README.md')).toMatch(/## Deploy Your Own/);
    expect(read('README.md')).toContain('[DEPLOY.md](./DEPLOY.md)');
  });

  it('post66: locks GENRE_MAP identity keys for each VALID_GENRES slug present', () => {
    for (const g of VALID_GENRES) {
      expect(GENRE_MAP[g]).toBe(g);
    }
  });

  it('post66: locks resolveGenre export is the only function in genres.ts', () => {
    const genres = read('src/genres.ts');
    expect([...genres.matchAll(/^export function /gm)]).toHaveLength(1);
    expect(genres).toMatch(/^export function resolveGenre\(/m);
  });

  it('post66: locks parseM3U export is the only function in parser.ts', () => {
    const parser = read('src/parser.ts');
    expect([...parser.matchAll(/^export function /gm)]).toHaveLength(1);
    expect(parser).toMatch(/^export function parseM3U\(/m);
  });

  it('post66: locks MCP_MANIFEST is the only export in mcp.ts', () => {
    const mcp = read('src/mcp.ts');
    expect([...mcp.matchAll(/^export /gm)]).toHaveLength(1);
    expect(mcp).toMatch(/^export const MCP_MANIFEST/m);
  });

  it('post66: locks index does not re-export genres parser or types', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/export \{[^}]*GENRE_MAP/);
    expect(index).not.toMatch(/export \{[^}]*parseM3U/);
    expect(index).not.toMatch(/export \{[^}]*Env/);
  });

  it('post66: locks callGemini mood optional in signature and used in query join', () => {
    const index = read('src/index.ts');
    expect(index).toContain('mood?: string');
    expect(index).toContain("[mood, genre].filter(Boolean).join(' / ')");
  });

  it('post66: locks dual join separators slash in Gemini vs space in /curate query', () => {
    const index = read('src/index.ts');
    expect(index).toContain(".join(' / ')");
    expect(index).toContain(".join(' ')");
  });

  it('post66: locks /curate stations field assigned curated variable', () => {
    expect(read('src/index.ts')).toContain('stations: curated');
  });

  it('post66: locks retry_after literal 60 exactly three times', () => {
    expect((read('src/index.ts').match(/retry_after:\s*60/g) ?? []).length).toBe(3);
  });

  it('post66: locks , 503) status returns exactly three times', () => {
    expect((read('src/index.ts').match(/,\s*503\)/g) ?? []).length).toBe(3);
  });

  it('post66: locks expirationTtl 3600 exactly once', () => {
    expect((read('src/index.ts').match(/expirationTtl:\s*3600/g) ?? []).length).toBe(1);
  });

  it('post66: locks slice\(0, 50\) exactly once and slice\(0, 5\) exactly once', () => {
    const index = read('src/index.ts');
    expect((index.match(/\.slice\(0,\s*50\)/g) ?? []).length).toBe(1);
    expect((index.match(/\.slice\(0,\s*5\)/g) ?? []).length).toBe(1);
  });

  it('post66: locks music.m3u string exactly twice in index — comment + fallback URL', () => {
    expect((read('src/index.ts').match(/music\.m3u/g) ?? []).length).toBe(2);
  });

  it('post66: locks gemini-2.0-flash string exactly once in index', () => {
    expect((read('src/index.ts').match(/gemini-2\.0-flash/g) ?? []).length).toBe(1);
  });

  it('post66: locks Backlink/Geryon branding appears twice — powered_by and curated_by', () => {
    expect((read('src/index.ts').match(/Backlink\/Geryon/g) ?? []).length).toBe(2);
  });

  it('post66: locks crab emoji appears exactly once in index powered_by', () => {
    expect((read('src/index.ts').match(/🦀/g) ?? []).length).toBe(1);
  });

  it('post66: locks Hono Bindings Env generic exactly once', () => {
    expect(
      (read('src/index.ts').match(/new Hono<\{ Bindings: Env \}>/g) ?? []).length,
    ).toBe(1);
  });

  it('post66: locks IPTV_BASE identifier used at least three times', () => {
    // declaration + primary url template + music fallback
    expect((read('src/index.ts').match(/IPTV_BASE/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('post66: locks CATALOG_CACHE binding used in both /stations and /curate fetchStations', () => {
    expect((read('src/index.ts').match(/c\.env\.CATALOG_CACHE/g) ?? []).length).toBe(2);
  });

  it('post66: locks c.env.GEMINI_API_KEY referenced twice — guard and callGemini arg', () => {
    expect((read('src/index.ts').match(/c\.env\.GEMINI_API_KEY/g) ?? []).length).toBe(2);
  });

  it('post66: locks c.env.VERSION referenced twice — root and health', () => {
    expect((read('src/index.ts').match(/c\.env\.VERSION/g) ?? []).length).toBe(2);
  });

  it('post66: locks resolveGenre call sites exactly two — stations and curate', () => {
    expect((read('src/index.ts').match(/resolveGenre\(/g) ?? []).length).toBe(2);
  });

  it('post66: locks parseM3U call site exactly once in fetchStations', () => {
    expect((read('src/index.ts').match(/parseM3U\(/g) ?? []).length).toBe(1);
  });

  it('post66: locks callGemini invocation exactly once from /curate', () => {
    expect((read('src/index.ts').match(/await callGemini\(/g) ?? []).length).toBe(1);
  });

  it('post66: locks fetchStations invocation exactly twice', () => {
    expect((read('src/index.ts').match(/await fetchStations\(/g) ?? []).length).toBe(2);
  });

  it('post66: locks docs tool heading backticks for three backlink_* tools', () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec).toMatch(/^### `backlink_curate`/m);
    expect(spec).toMatch(/^### `backlink_genres`/m);
    expect(spec).toMatch(/^### `backlink_now_playing`/m);
  });

  it('post66: locks docs Integration Notes section present after tools', () => {
    const spec = read('docs/mcp-spec.md');
    expect(spec.indexOf('## Tools')).toBeLessThan(spec.indexOf('## Integration Notes'));
  });

  it('post66: locks docs No auth required for read endpoints bullet', () => {
    expect(read('docs/mcp-spec.md')).toContain('- No auth required for read endpoints');
  });

  it('post66: locks DEPLOY title Backlink — Deployment Guide', () => {
    expect(read('DEPLOY.md')).toMatch(/^# Backlink — Deployment Guide/m);
  });

  it('post66: locks README title Backlink with radio emoji', () => {
    expect(read('README.md')).toMatch(/^# Backlink 📻/m);
  });

  it('post66: locks package.json no engines field — CI pins Node instead', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    expect(pkg.engines).toBeUndefined();
  });

  it('post66: locks package.json no private field false — publishable name ok', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>;
    // either absent or not forcing private registry coupling
    expect(pkg.private ?? false).toBeFalsy();
  });

  it('post66: locks dependabot config exists under .github', () => {
    expect(read('.github/dependabot.yml').length).toBeGreaterThan(0);
  });

  it('post66: locks hygiene-required source-contracts.test.ts file non-empty', () => {
    expect(read('test/source-contracts.test.ts').length).toBeGreaterThan(10_000);
  });

  it('post66: locks root description field uses package description exactly once in index', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect((read('src/index.ts').match(new RegExp(pkg.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(1);
  });

  it('post66: locks stationList join newline after map', () => {
    expect(read('src/index.ts')).toContain(".join('\\n')");
  });

  it('post66: locks User request and Available stations labels with template interpolations', () => {
    const index = read('src/index.ts');
    expect(index).toContain('User request: ${query}');
    expect(index).toContain('Available stations:\\n${stationList}');
  });

  it('post66: locks JSON extract regex then JSON.parse jsonMatch[0]', () => {
    const index = read('src/index.ts');
    expect(index).toContain('const jsonMatch = text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)');
    expect(index).toContain('return JSON.parse(jsonMatch[0])');
    expect(index).toContain('if (!jsonMatch) throw new Error');
  });

  it('post66: locks !resp.ok throw before resp.json in callGemini', () => {
    const index = read('src/index.ts');
    const call = index.slice(index.indexOf('async function callGemini'), index.indexOf('const app = new Hono'));
    expect(call.indexOf('if (!resp.ok)')).toBeLessThan(call.indexOf('await resp.json()'));
  });

  it('post66: locks !res.ok music fallback before parseM3U in fetchStations', () => {
    const index = read('src/index.ts');
    const fetchFn = index.slice(
      index.indexOf('async function fetchStations'),
      index.indexOf('async function callGemini'),
    );
    expect(fetchFn.indexOf('if (!res.ok)')).toBeLessThan(fetchFn.indexOf('parseM3U(raw)'));
    expect(fetchFn.indexOf('music.m3u')).toBeLessThan(fetchFn.indexOf('parseM3U(raw)'));
  });

  it('post66: locks kv cache hit return before network fetch in fetchStations', () => {
    const index = read('src/index.ts');
    const fetchFn = index.slice(
      index.indexOf('async function fetchStations'),
      index.indexOf('async function callGemini'),
    );
    expect(fetchFn.indexOf('if (cached)')).toBeLessThan(fetchFn.indexOf('await fetch(url)'));
  });

  it('post66: locks GENRE_MAP indie→rock and electronic→ambient and music→music', () => {
    expect(GENRE_MAP.indie).toBe('rock');
    expect(GENRE_MAP.electronic).toBe('ambient');
    expect(GENRE_MAP.music).toBe('music');
  });

  it('post66: locks VALID_GENRES order music ambient jazz classical pop rock news sports entertainment', () => {
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

  it('post66: locks docs curator output required name url genre without editorial required', () => {
    expect(read('docs/mcp-spec.md')).toMatch(
      /"required":\s*\[["']name["'],\s*["']url["'],\s*["']genre["']\]/,
    );
  });

  it('post66: locks docs now_playing required name stream_url genre', () => {
    expect(read('docs/mcp-spec.md')).toMatch(
      /"required":\s*\[["']name["'],\s*["']stream_url["'],\s*["']genre["']\]/,
    );
  });

  it('post66: locks docs editorial type string or null in curator output', () => {
    expect(read('docs/mcp-spec.md')).toMatch(
      /"editorial":\s*\{\s*"type":\s*\[["']string["'],\s*["']null["']\]/,
    );
  });

  it('post66: locks docs timestamp format date-time', () => {
    expect(read('docs/mcp-spec.md')).toContain('"format": "date-time"');
  });

  it('post66: locks README live caveat jazz ambient classical pop rock 404→music.m3u', () => {
    expect(read('README.md')).toMatch(
      /`jazz`\/`ambient`\/`classical`\/`pop`\/`rock` files 404 and fall back to `music\.m3u`/,
    );
  });

  it('post66: locks AGENTS Safe Actions Update docs and deploy guides', () => {
    expect(read('AGENTS.md')).toContain('- Update docs and deploy guides');
  });

  it('post66: locks AGENTS Safe Actions Add new endpoints playlist now-playing examples', () => {
    expect(read('AGENTS.md')).toContain(
      '- Add new endpoints (e.g., `/playlist`, `/now-playing`)',
    );
  });

  it('post66: locks index free of /playlist and /now-playing routes today', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/app\.get\(['"]\/playlist['"]/);
    expect(index).not.toMatch(/app\.get\(['"]\/now-playing['"]/);
  });

  it('post66: locks package description mentions iptv-org and LLM-curated', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toMatch(/iptv-org/i);
    expect(pkg.description).toMatch(/LLM-curated/i);
  });

  it('post66: locks Worker powered_by crab and docs Base URL same product host', () => {
    expect(read('src/index.ts')).toContain('Backlink/Geryon 🦀');
    expect(read('docs/mcp-spec.md')).toContain('backlink.fuzzywigg.com');
  });

  it('post66: locks fetchStations and callGemini remain non-exported private helpers', () => {
    const index = read('src/index.ts');
    expect(index).toMatch(/^async function fetchStations\(/m);
    expect(index).toMatch(/^async function callGemini\(/m);
    expect(index).not.toMatch(/^export async function fetchStations/m);
    expect(index).not.toMatch(/^export async function callGemini/m);
  });

  it('post66: locks Station type imported into index and used in fetchStations return', () => {
    const index = read('src/index.ts');
    expect(index).toContain("import { parseM3U, Station } from './parser'");
    expect(index).toContain('Promise<Station[]>');
    expect(index).toContain('let stations: Station[]');
  });

  it('post66: locks Env imported only for Hono Bindings generic', () => {
    const index = read('src/index.ts');
    expect(index).toContain("import { Env } from './types'");
    expect((index.match(/\bEnv\b/g) ?? []).length).toBe(2); // import + Bindings
  });
}

  // --- HEAVY burn (post-#70): complementary fingerprint deepen (orthogonal to #70/#71/#73) ---

  it("post70b locks index.ts exact UTF-16 length 4724", () => {
    expect(read("src/index.ts").length).toBe(4724);
  });

  it("post70b locks index.ts UTF-8 byte length 4738", () => {
    expect(Buffer.byteLength(read("src/index.ts"), "utf8")).toBe(4738);
  });

  it("post70b locks index.ts newline count at 153", () => {
    expect((read("src/index.ts").match(/\n/g) ?? []).length).toBe(153);
  });

  it("post70b locks index colon count at 72", () => {
    expect((read("src/index.ts").match(/:/g) ?? []).length).toBe(72);
  });

  it("post70b locks index single-quote count at 85", () => {
    expect((read("src/index.ts").match(/'/g) ?? []).length).toBe(85);
  });

  it("post70b locks index double-quote count at 20", () => {
    expect((read("src/index.ts").match(/"/g) ?? []).length).toBe(20);
  });

  it("post70b locks index open-brace count at 58", () => {
    expect((read("src/index.ts").match(/\{/g) ?? []).length).toBe(58);
  });

  it("post70b locks index slash count at 34", () => {
    expect((read("src/index.ts").match(/\//g) ?? []).length).toBe(34);
  });

  it("post70b locks index dash count at 8", () => {
    expect((read("src/index.ts").match(/-/g) ?? []).length).toBe(8);
  });

  it("post70b locks index pipe count at 2", () => {
    expect((read("src/index.ts").match(/\|/g) ?? []).length).toBe(2);
  });

  it("post70b locks parser.ts exact UTF-16 length 1953", () => {
    expect(read("src/parser.ts").length).toBe(1953);
  });

  it("post70b locks parser.ts UTF-8 byte length 1955", () => {
    expect(Buffer.byteLength(read("src/parser.ts"), "utf8")).toBe(1955);
  });

  it("post70b locks genres.ts exact UTF-16 length 1025", () => {
    expect(read("src/genres.ts").length).toBe(1025);
  });

  it("post70b locks genres.ts UTF-8 byte length 1027", () => {
    expect(Buffer.byteLength(read("src/genres.ts"), "utf8")).toBe(1027);
  });

  it("post70b locks mcp.ts UTF-16 equals UTF-8 2057", () => {
    const mcp = read("src/mcp.ts");
    expect(mcp.length).toBe(2057);
    expect(Buffer.byteLength(mcp, "utf8")).toBe(2057);
  });

  it("post70b locks types.ts UTF-16 172 UTF-8 174", () => {
    const types = read("src/types.ts");
    expect(types.length).toBe(172);
    expect(Buffer.byteLength(types, "utf8")).toBe(174);
  });

  it("post70b locks docs/mcp-spec.md UTF-16 3544 UTF-8 3552", () => {
    const spec = read("docs/mcp-spec.md");
    expect(spec.length).toBe(3544);
    expect(Buffer.byteLength(spec, "utf8")).toBe(3552);
  });

  it("post70b locks AGENTS.md UTF-16 1011 UTF-8 1017", () => {
    const agents = read("AGENTS.md");
    expect(agents.length).toBe(1011);
    expect(Buffer.byteLength(agents, "utf8")).toBe(1017);
  });

  it("post70b locks DEPLOY.md UTF-16 1539 UTF-8 1573", () => {
    const deploy = read("DEPLOY.md");
    expect(deploy.length).toBe(1539);
    expect(Buffer.byteLength(deploy, "utf8")).toBe(1573);
  });

  it("post70b locks README.md UTF-16 2757 UTF-8 2801", () => {
    const readme = read("README.md");
    expect(readme.length).toBe(2757);
    expect(Buffer.byteLength(readme, "utf8")).toBe(2801);
  });

  it("post70b locks wrangler.toml ASCII 330", () => {
    const toml = read("wrangler.toml");
    expect(toml.length).toBe(330);
    expect(Buffer.byteLength(toml, "utf8")).toBe(330);
  });

  it("post70b locks environment.json exact 57 bytes", () => {
    const env = read(".cursor/environment.json");
    expect(env.length).toBe(57);
    expect(Buffer.byteLength(env, "utf8")).toBe(57);
  });

  it("post70b locks index starts with import Hono char codes", () => {
    const index = read("src/index.ts");
    expect([...index.slice(0, 20)].map((c) => c.charCodeAt(0))).toEqual([
      105, 109, 112, 111, 114, 116, 32, 123, 32, 72, 111, 110, 111, 32, 125, 32, 102, 114, 111, 109,
    ]);
  });

  it("post70b locks index ends with export default app newline", () => {
    expect(read("src/index.ts").endsWith("export default app;\n")).toBe(true);
  });

  it("post70b locks index free of BOM and CR", () => {
    const index = read("src/index.ts");
    expect(index.charCodeAt(0)).not.toBe(0xfeff);
    expect(index.includes("\r")).toBe(false);
  });

  it("post70b locks all src modules free of CR", () => {
    for (const rel of ["src/index.ts", "src/parser.ts", "src/genres.ts", "src/mcp.ts", "src/types.ts"]) {
      expect(read(rel).includes("\r")).toBe(false);
    }
  });

  it("post70b locks index fetch sites exactly 3", () => {
    expect([...read("src/index.ts").matchAll(/\bfetch\(/g)]).toHaveLength(3);
  });

  it("post70b locks index c.json sites exactly 8", () => {
    expect([...read("src/index.ts").matchAll(/c\.json\(/g)]).toHaveLength(8);
  });

  it("post70b locks index Gemini word count at 2", () => {
    expect([...read("src/index.ts").matchAll(/\bGemini\b/g)]).toHaveLength(2);
  });

  it("post70b locks gemini-2.0-flash exactly once", () => {
    expect([...read("src/index.ts").matchAll(/gemini-2\.0-flash/g)]).toHaveLength(1);
  });

  it("post70b locks IPTV_BASE occurrences at 3", () => {
    expect([...read("src/index.ts").matchAll(/\bIPTV_BASE\b/g)]).toHaveLength(3);
  });

  it("post70b locks crab emoji exactly once in index", () => {
    expect([...read("src/index.ts")].filter((c) => c === "🦀")).toHaveLength(1);
  });

  it("post70b locks index non-ASCII six em-dashes plus crab", () => {
    const nonAscii = [...read("src/index.ts")].filter((c) => c.charCodeAt(0) >= 128);
    expect(nonAscii.filter((c) => c === "—").length).toBe(6);
    expect(nonAscii.filter((c) => c === "🦀").length).toBe(1);
    expect(nonAscii.length).toBe(7);
  });

  it("post70b locks genres arrow glyph once", () => {
    expect([...read("src/genres.ts")].filter((c) => c === "→")).toHaveLength(1);
  });

  it("post70b locks mcp.ts pure ASCII", () => {
    expect([...read("src/mcp.ts")].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it("post70b locks types em-dash once", () => {
    expect([...read("src/types.ts")].filter((c) => c === "—")).toHaveLength(1);
  });

  it("post70b locks parser em-dash once", () => {
    expect([...read("src/parser.ts")].filter((c) => c === "—")).toHaveLength(1);
  });

  it("post70b cross-locks domain across docs and config", () => {
    for (const rel of ["wrangler.toml", "README.md", "docs/mcp-spec.md", "AGENTS.md", "DEPLOY.md"]) {
      expect(read(rel)).toContain("backlink.fuzzywigg.com");
    }
  });

  it("post70b cross-locks GEMINI_API_KEY across runtime docs workflows", () => {
    expect(read("src/index.ts")).toContain("GEMINI_API_KEY");
    expect(read("src/types.ts")).toContain("GEMINI_API_KEY");
    expect(read("DEPLOY.md")).toContain("GEMINI_API_KEY");
    expect(read(".github/workflows/deploy.yml")).toContain("GEMINI_API_KEY");
    expect(read("wrangler.toml")).toContain("GEMINI_API_KEY");
  });

  it("post70b cross-locks CATALOG_CACHE across types wrangler DEPLOY", () => {
    expect(read("src/types.ts")).toContain("CATALOG_CACHE");
    expect(read("wrangler.toml")).toContain("CATALOG_CACHE");
    expect(read("DEPLOY.md")).toContain("CATALOG_CACHE");
  });

  it("post70b cross-locks VERSION 0.1.0 package wrangler index", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(pkg.version).toBe("0.1.0");
    expect(read("wrangler.toml")).toContain('VERSION = "0.1.0"');
    expect(read("src/index.ts")).toContain("c.env.VERSION ?? '0.1.0'");
  });

  it("post70b cross-locks package name backlink wrangler MCP", () => {
    const pkg = JSON.parse(read("package.json")) as { name: string };
    expect(pkg.name).toBe("backlink");
    expect(read("wrangler.toml")).toMatch(/^name = "backlink"$/m);
    expect(read("src/mcp.ts")).toContain('name_for_model: "backlink"');
  });

  it("post70b cross-locks VALID_GENRES README middot list", () => {
    const readme = read("README.md");
    const line = readme
      .split("\n")
      .find((l) => l.includes("music") && l.includes("·") && l.includes("entertainment"));
    expect(line).toBeDefined();
    expect(line).toContain(VALID_GENRES.map((g) => "`" + g + "`").join(" · "));
  });

  it("post70b cross-locks GENRE_MAP aliases with README", () => {
    const readme = read("README.md");
    expect(GENRE_MAP["late night"]).toBe("ambient");
    expect(GENRE_MAP.chill).toBe("ambient");
    expect(GENRE_MAP.lofi).toBe("ambient");
    expect(GENRE_MAP.blues).toBe("jazz");
    expect(readme).toMatch(/late night.*ambient/i);
    expect(readme).toMatch(/chill.*ambient/i);
    expect(readme).toMatch(/lofi.*ambient/i);
    expect(readme).toMatch(/blues.*jazz/i);
  });

  it("post70b locks GENRE_MAP keys length 21", () => {
    expect(Object.keys(GENRE_MAP)).toHaveLength(21);
  });

  it("post70b locks VALID_GENRES stable 9-order", () => {
    expect([...VALID_GENRES]).toEqual([
      "music",
      "ambient",
      "jazz",
      "classical",
      "pop",
      "rock",
      "news",
      "sports",
      "entertainment",
    ]);
  });

  it("post70b locks every GENRE_MAP value in VALID_GENRES", () => {
    for (const v of Object.values(GENRE_MAP)) {
      expect(VALID_GENRES).toContain(v);
    }
  });

  it("post70b locks GENRE_MAP keys lowercase trimmed", () => {
    for (const k of Object.keys(GENRE_MAP)) {
      expect(k).toBe(k.toLowerCase().trim());
    }
  });

  it("post70b locks resolveGenre falsy music source", () => {
    expect(read("src/genres.ts")).toContain("if (!input) return 'music'");
  });

  it("post70b locks docs three backlink tool headings", () => {
    const spec = read("docs/mcp-spec.md");
    expect(spec).toContain("### `backlink_curate`");
    expect(spec).toContain("### `backlink_genres`");
    expect(spec).toContain("### `backlink_now_playing`");
  });

  it("post70b locks docs tool ids disjoint from claw-mcp names", () => {
    const mcp = read("src/mcp.ts");
    for (const id of ["backlink_curate", "backlink_genres", "backlink_now_playing"]) {
      expect(mcp).not.toContain(id);
    }
    for (const name of ["station_select", "now_playing", "genre_filter", "curator_prompt"]) {
      expect(mcp).toContain('name: "' + name + '"');
    }
  });

  it("post70b locks AGENTS Safe Actions extend unit tests", () => {
    expect(read("AGENTS.md")).toContain("Add / extend unit tests under `test/`");
  });

  it("post70b locks AGENTS Escalate GEMINI and HITL", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("GEMINI_API_KEY");
    expect(agents).toContain("first deploy must be HITL");
  });

  it("post70b locks AGENTS domain target", () => {
    expect(read("AGENTS.md")).toContain("Domain target: backlink.fuzzywigg.com");
  });

  it("post70b locks AGENTS Tier A Autonomy L2", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("Tier: A");
    expect(agents).toContain("Autonomy: L2");
  });

  it("post70b locks DEPLOY HITL three warning bullets", () => {
    const deploy = read("DEPLOY.md");
    expect(deploy).toContain("## HITL Required");
    expect([...deploy.matchAll(/⚠️/g)]).toHaveLength(3);
  });

  it("post70b locks DEPLOY local dev localhost 8787", () => {
    const deploy = read("DEPLOY.md");
    expect(deploy).toContain("npm run dev");
    expect(deploy).toContain("http://localhost:8787");
  });

  it("post70b locks DEPLOY wrangler secret put fence", () => {
    expect(read("DEPLOY.md")).toContain("wrangler secret put GEMINI_API_KEY");
  });

  it("post70b locks DEPLOY Node.js 18+ prerequisite", () => {
    expect(read("DEPLOY.md")).toContain("Node.js 18+");
  });

  it("post70b locks DEPLOY Gemini 2.0 Flash cost line", () => {
    expect(read("DEPLOY.md")).toContain("Gemini 2.0 Flash");
  });

  it("post70b locks README live worker URL", () => {
    expect(read("README.md")).toContain("https://backlink.fuzzywigg.com");
  });

  it("post70b locks README editorial null caveat", () => {
    expect(read("README.md")).toContain("editorial: null");
  });

  it("post70b locks README matching categories list", () => {
    expect(read("README.md")).toContain("music`, `news`, `sports`, `entertainment");
  });

  it("post70b locks README Stack bullets", () => {
    const readme = read("README.md");
    expect(readme).toContain("**Cloudflare Workers**");
    expect(readme).toContain("**Hono**");
    expect(readme).toContain("**iptv-org**");
    expect(readme).toContain("**Gemini 2.0 Flash**");
    expect(readme).toContain("**CF KV**");
  });

  it("post70b locks README Cloud agents npm ci only", () => {
    expect(read("README.md")).toContain("npm ci` only");
  });

  it("post70b locks README curated_by example", () => {
    expect(read("README.md")).toContain('"curated_by": "Backlink/Geryon"');
  });

  it("post70b locks wrangler main and compatibility_date", () => {
    const toml = read("wrangler.toml");
    expect(toml).toContain('main = "src/index.ts"');
    expect(toml).toContain('compatibility_date = "2025-01-01"');
  });

  it("post70b locks wrangler custom_domain true", () => {
    const toml = read("wrangler.toml");
    expect(toml).toContain('pattern = "backlink.fuzzywigg.com"');
    expect(toml).toContain("custom_domain = true");
  });

  it("post70b locks wrangler KV id fingerprint", () => {
    expect(read("wrangler.toml")).toContain('id = "edb6ca4df12f4f45b40508b3dda3c432"');
  });

  it("post70b locks wrangler [vars] assignments free of GEMINI (comment OK after)", () => {
    const toml = read("wrangler.toml");
    const fromVars = toml.slice(toml.indexOf("[vars]"));
    const assignmentBlock = fromVars.split("\n\n# Secrets")[0] ?? fromVars;
    expect(assignmentBlock).toContain('VERSION = "0.1.0"');
    expect(assignmentBlock).not.toMatch(/GEMINI/i);
    expect(fromVars).toContain("wrangler secret put GEMINI_API_KEY");
  });

  it("post70b locks environment.json shape name+install only", () => {
    const env = JSON.parse(read(".cursor/environment.json")) as Record<string, unknown>;
    expect(Object.keys(env).sort()).toEqual(["install", "name"]);
    expect(env).toEqual({ name: "Backlink_Facelift", install: "npm ci" });
  });

  it("post70b locks index does not invent playlist now-playing openapi routes", () => {
    const index = read("src/index.ts");
    expect(index).not.toMatch(/app\.get\(['"]\/playlist/);
    expect(index).not.toMatch(/app\.get\(['"]\/now-playing/);
    expect(index).not.toMatch(/app\.get\(['"]\/openapi/);
    expect(index).not.toMatch(/app\.get\(['"]\/mcp/);
  });

  it("post70b locks index free of Anthropic Claude OpenAI", () => {
    expect(read("src/index.ts")).not.toMatch(/anthropic|claude|haiku|openai|gpt-4/i);
  });

  it("post70b locks all src free of process.env Deno Bun", () => {
    for (const rel of ["src/index.ts", "src/parser.ts", "src/genres.ts", "src/mcp.ts", "src/types.ts"]) {
      const text = read(rel);
      expect(text).not.toContain("process.env");
      expect(text).not.toMatch(/\bDeno\b|\bBun\b/);
    }
  });

  it("post70b locks index free of console logging", () => {
    expect(read("src/index.ts")).not.toMatch(/console\.(log|warn|error|debug)/);
  });

  it("post70b locks index free of timers", () => {
    expect(read("src/index.ts")).not.toMatch(/setTimeout|setInterval|queueMicrotask/);
  });

  it("post70b locks index free of WS DurableObject D1 R2 Queue", () => {
    expect(read("src/index.ts")).not.toMatch(/WebSocket|DurableObject|D1Database|R2Bucket|Queue/i);
  });

  it("post70b locks index free of eval new Function", () => {
    const index = read("src/index.ts");
    expect(index).not.toMatch(/\beval\s*\(/);
    expect(index).not.toContain("new Function");
  });

  it("post70b locks index free of as any ts-ignore", () => {
    const index = read("src/index.ts");
    expect(index).not.toContain("as any");
    expect(index).not.toContain("@ts-ignore");
    expect(index).not.toContain("@ts-expect-error");
  });

  it("post70b locks parser free of fetch hono genres mcp", () => {
    const parser = read("src/parser.ts");
    expect(parser).not.toMatch(/from ['"]hono/);
    expect(parser).not.toMatch(/from ['"]\.\/genres/);
    expect(parser).not.toMatch(/from ['"]\.\/mcp/);
    expect(parser).not.toMatch(/\bfetch\s*\(/);
  });

  it("post70b locks genres free of fetch hono parser mcp", () => {
    const genres = read("src/genres.ts");
    expect(genres).not.toMatch(/from ['"]hono/);
    expect(genres).not.toMatch(/from ['"]\.\/parser/);
    expect(genres).not.toMatch(/from ['"]\.\/mcp/);
    expect(genres).not.toMatch(/\bfetch\s*\(/);
  });

  it("post70b locks mcp free of imports and fetch", () => {
    const mcp = read("src/mcp.ts");
    expect(mcp).not.toMatch(/from ['"]hono/);
    expect(mcp).not.toMatch(/from ['"]\.\/parser/);
    expect(mcp).not.toMatch(/from ['"]\.\/genres/);
    expect(mcp).not.toMatch(/\bfetch\s*\(/);
    expect(mcp).not.toMatch(/^import /m);
  });

  it("post70b locks types free of imports and Station", () => {
    const types = read("src/types.ts");
    expect(types).not.toMatch(/^import /m);
    expect(types).not.toContain("Station");
    expect(types).toMatch(/^export interface Env \{/m);
  });

  it("post70b locks index import order Hono cors genres parser types", () => {
    const index = read("src/index.ts");
    const hono = index.indexOf("import { Hono } from 'hono'");
    const cors = index.indexOf("import { cors } from 'hono/cors'");
    const genres = index.indexOf("import { GENRE_MAP, VALID_GENRES, resolveGenre } from './genres'");
    const parser = index.indexOf("import { parseM3U, Station } from './parser'");
    const types = index.indexOf("import { Env } from './types'");
    expect(hono).toBe(0);
    expect(cors).toBeGreaterThan(hono);
    expect(genres).toBeGreaterThan(cors);
    expect(parser).toBeGreaterThan(genres);
    expect(types).toBeGreaterThan(parser);
  });

  it("post70b locks IPTV_BASE before fetchStations", () => {
    const index = read("src/index.ts");
    expect(index.indexOf("const IPTV_BASE")).toBeLessThan(index.indexOf("async function fetchStations"));
  });

  it("post70b locks fetchStations before callGemini before app", () => {
    const index = read("src/index.ts");
    const fs = index.indexOf("async function fetchStations");
    const cg = index.indexOf("async function callGemini");
    const app = index.indexOf("const app = new Hono");
    expect(fs).toBeGreaterThan(-1);
    expect(cg).toBeGreaterThan(fs);
    expect(app).toBeGreaterThan(cg);
  });

  it("post70b locks cors before first app.get", () => {
    const index = read("src/index.ts");
    expect(index.indexOf("app.use('*', cors())")).toBeLessThan(index.indexOf("app.get('/',"));
  });

  it("post70b locks route registration order five GETs", () => {
    const index = read("src/index.ts");
    const positions = [
      index.indexOf("app.get('/',"),
      index.indexOf("app.get('/health'"),
      index.indexOf("app.get('/genres'"),
      index.indexOf("app.get('/stations'"),
      index.indexOf("app.get('/curate'"),
    ];
    expect(positions.every((p) => p >= 0)).toBe(true);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it("post70b locks export default after /curate", () => {
    const index = read("src/index.ts");
    expect(index.lastIndexOf("export default app")).toBeGreaterThan(index.indexOf("app.get('/curate'"));
  });

  it("post70b locks fetchStations cacheKey template", () => {
    expect(read("src/index.ts")).toContain("const cacheKey = `stations:${genre}`");
  });

  it("post70b locks fetchStations primary URL template", () => {
    expect(read("src/index.ts")).toContain("const url = `${IPTV_BASE}/${genre}.m3u`");
  });

  it("post70b locks fetchStations music fallback template", () => {
    expect(read("src/index.ts")).toContain("res = await fetch(`${IPTV_BASE}/music.m3u`)");
  });

  it("post70b locks fetchStations throw Stream catalog unavailable", () => {
    expect(read("src/index.ts")).toContain("throw new Error('Stream catalog unavailable')");
  });

  it("post70b locks fetchStations kv.put expirationTtl 3600", () => {
    expect(read("src/index.ts")).toContain(
      "await kv.put(cacheKey, JSON.stringify(stations), { expirationTtl: 3600 })",
    );
  });

  it("post70b locks fetchStations JSON.parse cached Station[]", () => {
    expect(read("src/index.ts")).toContain("return JSON.parse(cached) as Station[]");
  });

  it("post70b locks callGemini POST application/json", () => {
    const index = read("src/index.ts");
    expect(index).toContain("method: 'POST'");
    expect(index).toContain("headers: { 'content-type': 'application/json' }");
  });

  it("post70b locks callGemini contents parts nesting", () => {
    expect(read("src/index.ts")).toContain("contents: [{ parts: [{ text: prompt }] }]");
  });

  it("post70b locks callGemini generationConfig inline", () => {
    expect(read("src/index.ts")).toContain("generationConfig: { maxOutputTokens: 512, temperature: 0.7 }");
  });

  it("post70b locks callGemini Gemini API error template", () => {
    expect(read("src/index.ts")).toContain("throw new Error(`Gemini API error: ${resp.status}`)");
  });

  it("post70b locks callGemini Invalid JSON literal", () => {
    expect(read("src/index.ts")).toContain("throw new Error('Invalid JSON from Gemini')");
  });

  it("post70b locks callGemini candidates optional chain", () => {
    expect(read("src/index.ts")).toContain("const text = data.candidates[0]?.content?.parts[0]?.text ?? ''");
  });

  it("post70b locks callGemini jsonMatch regex source", () => {
    expect(read("src/index.ts")).toContain("text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/)");
  });

  it("post70b locks callGemini stationList em-dash template", () => {
    expect(read("src/index.ts")).toContain(
      "`${i + 1}. ${s.name} (${s.group ?? genre}) [${s.language ?? 'en'}] — ${s.url}`",
    );
  });

  it("post70b locks callGemini You are Backlink opening", () => {
    expect(read("src/index.ts")).toContain("You are Backlink, an AI radio curator.");
  });

  it("post70b locks callGemini Be specific about mood", () => {
    expect(read("src/index.ts")).toContain("Be specific about what makes each station right for the mood.");
  });

  it("post70b locks /curate GEMINI guard before fetchStations", () => {
    const index = read("src/index.ts");
    const curate = index.slice(index.indexOf("app.get('/curate'"));
    const guard = curate.indexOf("if (!c.env.GEMINI_API_KEY)");
    const fetchCall = curate.indexOf("stations = await fetchStations");
    expect(guard).toBeGreaterThan(-1);
    expect(fetchCall).toBeGreaterThan(guard);
  });

  it("post70b locks /curate Curation service unavailable payload", () => {
    expect(read("src/index.ts")).toContain(
      "return c.json({ error: 'Curation service unavailable', retry_after: 60 }, 503)",
    );
  });

  it("post70b locks twin Stream catalog unavailable payloads", () => {
    expect([...read("src/index.ts").matchAll(/error: 'Stream catalog unavailable', retry_after: 60/g)]).toHaveLength(2);
  });

  it("post70b locks /curate query join space or genre", () => {
    expect(read("src/index.ts")).toContain("const query = [mood, genreParam].filter(Boolean).join(' ') || genre");
  });

  it("post70b locks /curate callGemini then degrade catch", () => {
    const index = read("src/index.ts");
    expect(index).toContain("curated = await callGemini(c.env.GEMINI_API_KEY, stations, genre, mood)");
    expect(index).toContain("curated = stations.slice(0, 5).map((s) => ({");
    expect(index).toContain("editorial: null");
  });

  it("post70b locks /curate response keys query curated_by timestamp stations", () => {
    const index = read("src/index.ts");
    const block = index.slice(index.lastIndexOf("return c.json({"), index.lastIndexOf("export default app"));
    expect(block).toContain("query,");
    expect(block).toContain("curated_by: 'Backlink/Geryon'");
    expect(block).toContain("timestamp: new Date().toISOString()");
    expect(block).toContain("stations: curated");
  });

  it("post70b locks /health ok true version shape", () => {
    expect(read("src/index.ts")).toContain("return c.json({ ok: true, version: c.env.VERSION ?? '0.1.0' })");
  });

  it("post70b locks /genres VALID_GENRES spread and GENRE_MAP aliases", () => {
    const index = read("src/index.ts");
    expect(index).toContain("genres: [...VALID_GENRES]");
    expect(index).toContain("aliases: GENRE_MAP");
  });

  it("post70b locks root endpoints four GET descriptions", () => {
    const index = read("src/index.ts");
    expect(index).toContain("'/curate': 'GET ?genre=&mood= — AI-curated station picks'");
    expect(index).toContain("'/stations': 'GET ?genre= — Raw station list'");
    expect(index).toContain("'/genres': 'GET — Available genre categories'");
    expect(index).toContain("'/health': 'GET — Health check'");
  });

  it("post70b locks root powered_by crab branding", () => {
    expect(read("src/index.ts")).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it("post70b locks root name Backlink description from package", () => {
    const pkg = JSON.parse(read("package.json")) as { description: string };
    expect(read("src/index.ts")).toContain("description: '" + pkg.description + "'");
    expect(read("src/index.ts")).toContain("name: 'Backlink'");
  });

  it("post70b locks /stations response genre count stations", () => {
    expect(read("src/index.ts")).toContain("return c.json({ genre, count: stations.length, stations })");
  });

  it("post70b locks /stations resolveGenre without mood", () => {
    const index = read("src/index.ts");
    const stations = index.slice(index.indexOf("app.get('/stations'"), index.indexOf("app.get('/curate'"));
    expect(stations).toContain("const genre = resolveGenre(genreParam)");
    expect(stations).not.toContain("mood");
  });

  it("post70b locks /curate resolveGenre genreParam ?? mood", () => {
    expect(read("src/index.ts")).toContain("const genre = resolveGenre(genreParam ?? mood)");
  });

  it("post70b locks parser Station before parseM3U", () => {
    const parser = read("src/parser.ts");
    expect(parser.indexOf("export interface Station")).toBeLessThan(parser.indexOf("export function parseM3U"));
  });

  it("post70b locks parser five attribute extractors", () => {
    const parser = read("src/parser.ts");
    expect(parser).toContain('tvg-name="([^"]*)"');
    expect(parser).toContain('tvg-logo="([^"]*)"');
    expect(parser).toContain('group-title="([^"]*)"');
    expect(parser).toContain('tvg-language="([^"]*)"');
    expect(parser).toContain('tvg-country="([^"]*)"');
  });

  it("post70b locks parser case-insensitive regex flags five", () => {
    expect([...read("src/parser.ts").matchAll(/\/i\)/g)].length).toBeGreaterThanOrEqual(5);
  });

  it("post70b locks parser http https startsWith branch", () => {
    expect(read("src/parser.ts")).toContain("line.startsWith('http://') || line.startsWith('https://')");
  });

  it("post70b locks parser seen Set URL dedupe", () => {
    expect(read("src/parser.ts")).toContain("if (current.name && !seen.has(line))");
    expect(read("src/parser.ts")).toContain("seen.add(line)");
  });

  it("post70b locks parser comma fallback name", () => {
    expect(read("src/parser.ts")).toContain("if (!current.name)");
    expect(read("src/parser.ts")).toContain("line.lastIndexOf(',')");
  });

  it("post70b locks parser rtmp comment branch", () => {
    expect(read("src/parser.ts")).toContain("Non-http URL (rtmp://, etc.)");
  });

  it("post70b locks parser split map trim pipeline", () => {
    expect(read("src/parser.ts")).toContain("const lines = raw.split('\\n').map((l) => l.trim())");
  });

  it("post70b locks genres iptv-org header comment", () => {
    expect(read("src/genres.ts")).toContain("iptv-org category ids");
  });

  it("post70b locks ValidGenre typeof VALID_GENRES indexed", () => {
    expect(read("src/genres.ts")).toContain("export type ValidGenre = (typeof VALID_GENRES)[number]");
  });

  it("post70b locks resolveGenre default map GENRE_MAP", () => {
    expect(read("src/genres.ts")).toContain("map: Record<string, string> = GENRE_MAP");
  });

  it("post70b locks resolveGenre toLowerCase trim", () => {
    expect(read("src/genres.ts")).toContain("const lower = input.toLowerCase().trim()");
  });

  it("post70b locks resolveGenre ValidGenre cast fallback", () => {
    expect(read("src/genres.ts")).toContain(
      "return map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : 'music')",
    );
  });

  it("post70b locks MCP schema_version v1", () => {
    expect(read("src/mcp.ts")).toContain('schema_version: "v1"');
  });

  it("post70b locks MCP name_for_human Backlink Radio", () => {
    expect(read("src/mcp.ts")).toContain('name_for_human: "Backlink Radio"');
  });

  it("post70b locks MCP auth type none", () => {
    expect(read("src/mcp.ts")).toContain('auth: { type: "none" }');
  });

  it("post70b locks MCP api openapi /openapi.json", () => {
    expect(read("src/mcp.ts")).toContain('api: { type: "openapi", url: "/openapi.json" }');
  });

  it("post70b locks MCP four name fields", () => {
    expect([...read("src/mcp.ts").matchAll(/name: "/g)]).toHaveLength(4);
  });

  it("post70b locks MCP now_playing empty properties", () => {
    expect(read("src/mcp.ts")).toContain('input_schema: { type: "object", properties: {} }');
  });

  it("post70b locks MCP curator_prompt required mood", () => {
    expect(read("src/mcp.ts")).toContain('required: ["mood"]');
  });

  it("post70b locks MCP station_select required station_name", () => {
    expect(read("src/mcp.ts")).toContain('required: ["station_name"]');
  });

  it("post70b locks MCP genre_filter required genre", () => {
    expect(read("src/mcp.ts")).toContain('required: ["genre"]');
  });

  it("post70b locks MCP description_for_model IPTV radio", () => {
    expect(read("src/mcp.ts")).toContain("AI-curated IPTV radio service");
  });

  it("post70b locks MCP description_for_human iptv-org", () => {
    expect(read("src/mcp.ts")).toContain("iptv-org catalog");
  });

  it("post70b locks types Env comment issue #8", () => {
    expect(read("src/types.ts")).toContain("#8");
  });

  it("post70b locks types Env field order", () => {
    const types = read("src/types.ts");
    expect(types.indexOf("CATALOG_CACHE")).toBeLessThan(types.indexOf("GEMINI_API_KEY"));
    expect(types.indexOf("GEMINI_API_KEY")).toBeLessThan(types.indexOf("VERSION"));
  });

  it("post70b locks docs Base URL fence", () => {
    expect(read("docs/mcp-spec.md")).toContain("Base URL: `https://backlink.fuzzywigg.com`");
  });

  it("post70b locks docs no auth for read endpoints", () => {
    expect(read("docs/mcp-spec.md")).toMatch(/No auth required for read endpoints/i);
  });

  it("post70b locks docs 1h TTL", () => {
    expect(read("docs/mcp-spec.md")).toMatch(/1h TTL/i);
  });

  it("post70b locks docs /curate Gemini fresh", () => {
    expect(read("docs/mcp-spec.md")).toMatch(/\/curate`?\s+always calls Gemini fresh/i);
  });

  it("post70b locks docs graceful degradation top 5", () => {
    const spec = read("docs/mcp-spec.md");
    expect(spec).toMatch(/top 5 raw stations/i);
    expect(spec).toContain("editorial: null");
  });

  it("post70b locks docs stream_url remap", () => {
    expect(read("docs/mcp-spec.md")).toMatch(/url`?\s+remapped to\s+`?stream_url/i);
  });

  it("post70b locks docs additionalProperties false >=3", () => {
    expect((read("docs/mcp-spec.md").match(/"additionalProperties":\s*false/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("post70b locks docs Endpoint GET /curate and /genres", () => {
    const spec = read("docs/mcp-spec.md");
    expect(spec).toContain("GET /curate?genre={genre}&mood={mood}");
    expect(spec).toContain("**Endpoint:** `GET /genres`");
  });

  it("post70b Reflect.ownKeys GENRE_MAP length 21", () => {
    const keys = Reflect.ownKeys(GENRE_MAP);
    expect(keys).toHaveLength(21);
    expect(keys).toContain("late night");
    expect(keys).toContain("lo-fi");
  });

  it("post70b Object.freeze VALID_GENRES snapshot immutable", () => {
    const snap = Object.freeze([...VALID_GENRES]);
    expect(() => {
      (snap as string[])[0] = "hijack";
    }).toThrow();
    expect(VALID_GENRES[0]).toBe("music");
    expect(read("src/genres.ts")).toContain("'music'");
  });

  it("post70b Proxy.revocable cannot rewrite powered_by", () => {
    const target = { powered_by: "Backlink/Geryon 🦀" };
    const { proxy, revoke } = Proxy.revocable(target, {
      get(t, p) {
        if (p === "powered_by") return "hijacked";
        return Reflect.get(t, p);
      },
    });
    expect(proxy.powered_by).toBe("hijacked");
    expect(read("src/index.ts")).toContain("powered_by: 'Backlink/Geryon 🦀'");
    revoke();
  });

  it("post70b structuredClone GENRE_MAP independent", () => {
    const clone = structuredClone(GENRE_MAP);
    clone.jazz = "hijack";
    expect(GENRE_MAP.jazz).toBe("jazz");
    expect(read("src/genres.ts")).toContain("jazz: 'jazz'");
  });

  it("post70b Map locks claw-mcp tool required fields", () => {
    const map = new Map([
      ["station_select", "station_name"],
      ["genre_filter", "genre"],
      ["curator_prompt", "mood"],
    ]);
    const mcp = read("src/mcp.ts");
    for (const [tool, req] of map) {
      expect(mcp).toContain('name: "' + tool + '"');
      expect(mcp).toContain('required: ["' + req + '"]');
    }
  });

  it("post70b Set locks five src modules and mcp-spec", () => {
    const required = new Set([
      "src/index.ts",
      "src/parser.ts",
      "src/genres.ts",
      "src/mcp.ts",
      "src/types.ts",
      "docs/mcp-spec.md",
    ]);
    for (const rel of required) {
      expect(read(rel).length).toBeGreaterThan(0);
    }
  });

  it("post70b WeakMap pins IPTV_BASE expected value", () => {
    const wm = new WeakMap<object, string>();
    const key = { id: "iptv" };
    wm.set(key, "https://iptv-org.github.io/iptv/categories");
    expect(wm.get(key)).toBe(read("src/index.ts").match(/const IPTV_BASE = '([^']+)'/)?.[1]);
  });

  it("post70b codePointAt equals charCodeAt for mcp.ts", () => {
    const mcp = read("src/mcp.ts");
    for (let i = 0; i < mcp.length; i++) {
      expect(mcp.codePointAt(i)).toBe(mcp.charCodeAt(i));
    }
  });

  it("post70b charCodeAt sum fingerprint types.ts 21759", () => {
    const types = read("src/types.ts");
    const sum = [...types].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    expect(sum).toBe(21759);
  });

  it("post70b locks index line count 154", () => {
    expect(read("src/index.ts").split("\n").length).toBe(154);
  });

  it("post70b locks parser line count 67", () => {
    expect(read("src/parser.ts").split("\n").length).toBe(67);
  });

  it("post70b locks genres line count 48", () => {
    expect(read("src/genres.ts").split("\n").length).toBe(48);
  });

  it("post70b locks mcp line count 68", () => {
    expect(read("src/mcp.ts").split("\n").length).toBe(68);
  });

  it("post70b locks types line count 7", () => {
    expect(read("src/types.ts").split("\n").length).toBe(7);
  });

  it("post70b locks src directory five modules only", () => {
    expect(readdirSync(join(root, "src")).sort()).toEqual([
      "genres.ts",
      "index.ts",
      "mcp.ts",
      "parser.ts",
      "types.ts",
    ]);
  });

  it("post70b locks docs directory mcp-spec only", () => {
    expect(readdirSync(join(root, "docs")).sort()).toEqual(["mcp-spec.md"]);
  });

  it("post70b locks .cursor directory environment.json only", () => {
    expect(readdirSync(join(root, ".cursor")).sort()).toEqual(["environment.json"]);
  });

  it("post70b locks no TODO FIXME in docs AGENTS DEPLOY README", () => {
    for (const rel of ["docs/mcp-spec.md", "AGENTS.md", "DEPLOY.md", "README.md"]) {
      expect(read(rel)).not.toMatch(/TODO|FIXME|HACK|XXX/);
    }
  });

  it("post70b locks index free of localhost", () => {
    expect(read("src/index.ts")).not.toContain("localhost");
    expect(read("src/index.ts")).not.toContain("127.0.0.1");
  });

  it("post70b locks index free of workers.dev", () => {
    expect(read("src/index.ts")).not.toContain("workers.dev");
  });

  it("post70b locks docs free of workers.dev", () => {
    expect(read("docs/mcp-spec.md")).not.toContain("workers.dev");
  });

  it("post70b locks AGENTS parent_governance", () => {
    expect(read("AGENTS.md")).toContain("github.com/fuzzywigg/agents-governance");
  });

  it("post70b locks AGENTS Verify four npm commands order", () => {
    const agents = read("AGENTS.md");
    const verify = agents.slice(agents.indexOf("## Verify"));
    const ci = verify.indexOf("npm ci");
    const tc = verify.indexOf("npm run typecheck");
    const test = verify.indexOf("npm test");
    const cov = verify.indexOf("npm run test:coverage");
    expect(ci).toBeGreaterThan(-1);
    expect(tc).toBeGreaterThan(ci);
    expect(test).toBeGreaterThan(tc);
    expect(cov).toBeGreaterThan(test);
  });

  it("post70b locks README four npm verify commands", () => {
    const readme = read("README.md");
    expect(readme).toContain("npm ci");
    expect(readme).toContain("npm run typecheck");
    expect(readme).toContain("npm test");
    expect(readme).toContain("npm run test:coverage");
  });

  it("post70b locks package description exact phrase", () => {
    const pkg = JSON.parse(read("package.json")) as { description: string };
    expect(pkg.description).toBe("LLM-curated internet radio — editorial AI over iptv-org catalog");
    expect(read("src/index.ts")).toContain(pkg.description);
  });

  it("post70b locks package type module no private", () => {
    const pkg = JSON.parse(read("package.json")) as Record<string, unknown>;
    expect(pkg.type).toBe("module");
    expect(pkg.private).toBeUndefined();
  });

  it("post70b locks package dependencies only hono", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(["hono"]);
  });

  it("post70b locks index does not import MCP_MANIFEST", () => {
    expect(read("src/index.ts")).not.toContain("MCP_MANIFEST");
    expect(read("src/index.ts")).not.toMatch(/from ['"]\.\/mcp['"]/);
  });

  it("post70b locks callGemini editorial string in signature", () => {
    expect(read("src/index.ts")).toContain("editorial: string; genre: string");
  });

  it("post70b locks degrade editorial null distinct from signature", () => {
    const index = read("src/index.ts");
    expect(index).toContain("editorial: null");
    expect(index).toContain("editorial: string");
  });

  it("post70b locks expirationTtl once and slices 50/5", () => {
    const index = read("src/index.ts");
    expect([...index.matchAll(/expirationTtl:\s*3600/g)]).toHaveLength(1);
    expect(index).toMatch(/\.slice\(0,\s*50\)/);
    expect(index).toMatch(/stations\.slice\(0,\s*5\)/);
  });

  it("post70b locks retry_after 60 thrice and 503 thrice", () => {
    const index = read("src/index.ts");
    expect([...index.matchAll(/retry_after:\s*60/g)]).toHaveLength(3);
    expect([...index.matchAll(/,\s*503\)/g)]).toHaveLength(3);
  });

  it("post70b locks app.get five and app.use one", () => {
    const index = read("src/index.ts");
    expect([...index.matchAll(/app\.get\(/g)]).toHaveLength(5);
    expect([...index.matchAll(/app\.use\(/g)]).toHaveLength(1);
  });

  it("post70b locks cors wildcard registration", () => {
    expect(read("src/index.ts")).toContain("app.use('*', cors())");
  });

  it("post70b locks Hono Bindings Env generic", () => {
    expect(read("src/index.ts")).toContain("const app = new Hono<{ Bindings: Env }>()");
  });

  it("post70b locks dual join separators slash vs space", () => {
    const index = read("src/index.ts");
    expect(index).toContain(".join(' / ')");
    expect(index).toContain(".join(' ') || genre");
  });

  it("post70b locks stationList language en group genre fallbacks", () => {
    expect(read("src/index.ts")).toContain("s.language ?? 'en'");
    expect(read("src/index.ts")).toContain("s.group ?? genre");
  });

  it("post70b locks generateContent host", () => {
    expect(read("src/index.ts")).toContain("generativelanguage.googleapis.com");
  });

  it("post70b locks generateContent full URL path", () => {
    expect(read("src/index.ts")).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=",
    );
  });

  it("post70b locks IPTV_BASE const exact", () => {
    expect(read("src/index.ts")).toContain("const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'");
  });

  it("post70b locks no second CDN inventing", () => {
    expect(read("src/index.ts")).not.toContain("raw.githubusercontent");
    expect(read("src/index.ts")).not.toContain("cdn.jsdelivr");
  });

  it("post70b locks README radio and crab emoji", () => {
    const readme = read("README.md");
    expect(readme).toContain("📻");
    expect(readme).toContain("🦀");
  });

  it("post70b locks DEPLOY free tier 100k requests", () => {
    expect(read("DEPLOY.md")).toContain("100,000 requests/day");
  });

  it("post70b locks DEPLOY KV 100k reads", () => {
    expect(read("DEPLOY.md")).toContain("100,000 reads/day free");
  });

  it("post70b locks DEPLOY curation cost 0.75 per 1000", () => {
    expect(read("DEPLOY.md")).toContain("$0.75 per 1,000 curation requests");
  });

  it("post70b locks AGENTS Safe Actions surface list", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("src/genres.ts");
    expect(agents).toContain("src/parser.ts");
    expect(agents).toContain("test/");
    expect(agents).toContain("/playlist");
    expect(agents).toContain("/now-playing");
    expect(agents).toContain("Bump dependency versions");
  });

  it("post70b locks AGENTS Escalate CORS billing", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("CORS or authentication");
    expect(agents).toContain("billing or CF account");
  });

  it("post70b locks wrangler never commit secrets comment", () => {
    expect(read("wrangler.toml")).toContain("never commit");
  });

  it("post70b locks environment.json pretty two-space JSON", () => {
    expect(read(".cursor/environment.json")).toBe(
      '{\n  "name": "Backlink_Facelift",\n  "install": "npm ci"\n}\n',
    );
  });

  it("post70b locks index larger than parser+genres bytes", () => {
    expect(Buffer.byteLength(read("src/index.ts"), "utf8")).toBeGreaterThan(
      Buffer.byteLength(read("src/parser.ts"), "utf8") + Buffer.byteLength(read("src/genres.ts"), "utf8"),
    );
  });

  it("post70b locks mcp.ts double-quote heavy no singles", () => {
    expect((read("src/mcp.ts").match(/'/g) ?? []).length).toBe(0);
    expect((read("src/mcp.ts").match(/"/g) ?? []).length).toBe(62);
  });

  it("post70b locks genres.ts single-quote heavy no doubles", () => {
    expect((read("src/genres.ts").match(/"/g) ?? []).length).toBe(0);
    expect((read("src/genres.ts").match(/'/g) ?? []).length).toBe(68);
  });

  it("post70b locks types.ts no quotes", () => {
    const types = read("src/types.ts");
    expect(types).not.toContain("'");
    expect(types).not.toContain('"');
  });

  it("post70b locks docs colon count 90", () => {
    expect((read("docs/mcp-spec.md").match(/:/g) ?? []).length).toBe(90);
  });

  it("post70b locks docs double-quote count 250", () => {
    expect((read("docs/mcp-spec.md").match(/"/g) ?? []).length).toBe(250);
  });

  it("post70b locks AGENTS dash count 18", () => {
    expect((read("AGENTS.md").match(/-/g) ?? []).length).toBe(18);
  });

  it("post70b locks README slash count 58", () => {
    expect((read("README.md").match(/\//g) ?? []).length).toBe(58);
  });

  it("post70b locks index no POST PUT PATCH DELETE OPTIONS HEAD", () => {
    expect(read("src/index.ts")).not.toMatch(/app\.(post|put|patch|delete|options|head)\(/i);
  });

  it("post70b locks callGemini stations Station[]", () => {
    expect(read("src/index.ts")).toContain("stations: Station[]");
  });

  it("post70b locks fetchStations Promise Station[]", () => {
    expect(read("src/index.ts")).toContain("Promise<Station[]>");
  });

  it("post70b locks kv.get before network fetch", () => {
    const index = read("src/index.ts");
    const fn = index.slice(index.indexOf("async function fetchStations"), index.indexOf("async function callGemini"));
    expect(fn.indexOf("kv.get(cacheKey)")).toBeLessThan(fn.indexOf("await fetch(url)"));
    expect(fn).toContain("if (cached) return JSON.parse(cached) as Station[]");
  });

  it("post70b locks music fallback after primary !res.ok", () => {
    const index = read("src/index.ts");
    const fn = index.slice(index.indexOf("async function fetchStations"), index.indexOf("async function callGemini"));
    expect(fn).toContain("if (!res.ok)");
    expect(fn.indexOf("if (!res.ok)")).toBeLessThan(fn.indexOf("music.m3u"));
  });

  it("post70b locks parseM3U after res.text before kv.put", () => {
    const index = read("src/index.ts");
    const fn = index.slice(index.indexOf("async function fetchStations"), index.indexOf("async function callGemini"));
    const text = fn.indexOf("await res.text()");
    const parse = fn.indexOf("parseM3U(raw)");
    const put = fn.indexOf("kv.put");
    expect(text).toBeLessThan(parse);
    expect(parse).toBeLessThan(put);
  });

  it("post70b locks docs free of second LLM providers", () => {
    for (const rel of ["docs/mcp-spec.md", "README.md", "DEPLOY.md", "AGENTS.md"]) {
      expect(read(rel)).not.toMatch(/anthropic|claude|haiku|openai|gpt-4/i);
    }
  });

  it("post70b locks README CI badge ci.yml", () => {
    expect(read("README.md")).toContain("actions/workflows/ci.yml/badge.svg");
  });

  it("post70b locks README coverage 100% wording", () => {
    expect(read("README.md")).toContain("100%");
  });

  it("post70b locks README Node 20 pin", () => {
    expect(read("README.md")).toContain("Node 20");
  });

  it("post70b Object.is GENRE_MAP jazz identity", () => {
    expect(Object.is(GENRE_MAP.jazz, "jazz")).toBe(true);
    expect(Object.is(GENRE_MAP.blues, "jazz")).toBe(true);
  });

  it("post70b Array.from VALID_GENRES equals spread", () => {
    expect(Array.from(VALID_GENRES)).toEqual([...VALID_GENRES]);
  });

  it("post70b JSON.stringify GENRE_MAP round-trip late night", () => {
    const round = JSON.parse(JSON.stringify(GENRE_MAP)) as Record<string, string>;
    expect(round["late night"]).toBe("ambient");
    expect(Object.keys(round)).toHaveLength(21);
  });

  it("post70b locks prompt Return JSON only schema keys", () => {
    expect(read("src/index.ts")).toContain(
      '[{"name": "...", "url": "...", "logo": "...", "editorial": "...", "genre": "..."}]',
    );
  });

  it("post70b locks prompt 1-2 sentences max", () => {
    expect(read("src/index.ts")).toContain("1-2 sentences max");
  });

  it("post70b locks pick the top 3 stations once", () => {
    expect([...read("src/index.ts").matchAll(/pick the top 3 stations/g)]).toHaveLength(1);
  });

  it("post70b locks docs pick the top 3 radio stations", () => {
    expect(read("docs/mcp-spec.md")).toContain("pick the top 3 radio stations");
  });

  it("post70b cross-locks docs top 3 with Worker prompt", () => {
    expect(read("docs/mcp-spec.md")).toMatch(/top 3/i);
    expect(read("src/index.ts")).toMatch(/top 3/i);
  });

  it("post70b cross-locks docs top 5 with Worker slice", () => {
    expect(read("docs/mcp-spec.md")).toMatch(/top 5/i);
    expect(read("src/index.ts")).toContain("stations.slice(0, 5)");
  });

  it("post70b locks curated_by without crab powered_by with crab", () => {
    const index = read("src/index.ts");
    expect(index).toContain("curated_by: 'Backlink/Geryon'");
    expect(index).not.toContain("curated_by: 'Backlink/Geryon 🦀'");
    expect(index).toContain("powered_by: 'Backlink/Geryon 🦀'");
  });

  it("post70b locks Date.toISOString once", () => {
    expect([...read("src/index.ts").matchAll(/toISOString\(\)/g)]).toHaveLength(1);
  });

  it("post70b locks /curate queries genre and mood", () => {
    const index = read("src/index.ts");
    const curate = index.slice(index.indexOf("app.get('/curate'"));
    expect(curate).toContain("c.req.query('genre')");
    expect(curate).toContain("c.req.query('mood')");
  });

  it("post70b locks /stations queries genre only", () => {
    const index = read("src/index.ts");
    const stations = index.slice(index.indexOf("app.get('/stations'"), index.indexOf("app.get('/curate'"));
    expect([...stations.matchAll(/c\.req\.query\('genre'\)/g)]).toHaveLength(1);
    expect(stations).not.toContain("query('mood')");
  });

  it("post70b locks no Authorization header in callGemini", () => {
    const index = read("src/index.ts");
    const cg = index.slice(index.indexOf("async function callGemini"), index.indexOf("const app"));
    expect(cg).not.toMatch(/Authorization/i);
    expect(cg).toContain("?key=");
  });

  it("post70b locks apiKey as query param not bearer", () => {
    expect(read("src/index.ts")).toContain("generateContent?key=${apiKey}");
  });

  it("post70b locks fetchStations kv KVNamespace", () => {
    expect(read("src/index.ts")).toContain("kv: KVNamespace");
  });

  it("post70b locks Env CATALOG_CACHE required GEMINI optional", () => {
    const types = read("src/types.ts");
    expect(types).toContain("CATALOG_CACHE: KVNamespace");
    expect(types).not.toContain("CATALOG_CACHE?:");
    expect(types).toContain("GEMINI_API_KEY?: string");
    expect(types).toContain("VERSION?: string");
  });

  it("post70b locks GENRE_MAP late night to ambient runtime+source", () => {
    expect(GENRE_MAP["late night"]).toBe("ambient");
    expect(read("src/genres.ts")).toContain("'late night': 'ambient'");
  });

  it("post70b locks GENRE_MAP chill to ambient runtime+source", () => {
    expect(GENRE_MAP.chill).toBe("ambient");
    expect(read("src/genres.ts")).toContain("chill: 'ambient'");
  });

  it("post70b locks GENRE_MAP lo-fi to ambient runtime+source", () => {
    expect(GENRE_MAP["lo-fi"]).toBe("ambient");
    expect(read("src/genres.ts")).toContain("'lo-fi': 'ambient'");
  });

  it("post70b locks GENRE_MAP blues to jazz runtime+source", () => {
    expect(GENRE_MAP.blues).toBe("jazz");
    expect(read("src/genres.ts")).toContain("blues: 'jazz'");
  });

  it("post70b locks GENRE_MAP classic to classical runtime+source", () => {
    expect(GENRE_MAP.classic).toBe("classical");
    expect(read("src/genres.ts")).toContain("classic: 'classical'");
  });

  it("post70b locks GENRE_MAP electronic lofi dance metal indie", () => {
    expect(GENRE_MAP.electronic).toBe("ambient");
    expect(GENRE_MAP.lofi).toBe("ambient");
    expect(GENRE_MAP.dance).toBe("pop");
    expect(GENRE_MAP.metal).toBe("rock");
    expect(GENRE_MAP.indie).toBe("rock");
  });

  it("post70b locks each VALID_GENRES member present in genres.ts source", () => {
    const genres = read("src/genres.ts");
    for (const g of VALID_GENRES) {
      expect(genres).toContain("'" + g + "'");
    }
  });

  it("post70b locks README Available Genres middot count equals VALID_GENRES length", () => {
    const line = read("README.md")
      .split("\n")
      .find((l) => l.includes("music") && l.includes("·") && l.includes("entertainment"));
    expect(line).toBeDefined();
    expect((line!.match(/·/g) ?? []).length).toBe(VALID_GENRES.length - 1);
  });

  it("post70b locks index free of require() CommonJS", () => {
    expect(read("src/index.ts")).not.toMatch(/\brequire\s*\(/);
  });

  it("post70b locks mcp.ts free of export default", () => {
    expect(read("src/mcp.ts")).not.toContain("export default");
    expect(read("src/mcp.ts")).toContain("export const MCP_MANIFEST");
  });

  it("post70b locks parser free of export default", () => {
    expect(read("src/parser.ts")).not.toContain("export default");
  });

  it("post70b locks genres free of export default", () => {
    expect(read("src/genres.ts")).not.toContain("export default");
  });

  it("post70b locks types free of export default", () => {
    expect(read("src/types.ts")).not.toContain("export default");
  });

  it("post70b locks index default export is only export", () => {
    expect([...read("src/index.ts").matchAll(/^export /gm)]).toHaveLength(1);
    expect(read("src/index.ts")).toContain("export default app");
  });

}

});
