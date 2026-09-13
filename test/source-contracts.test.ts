import { readFileSync } from 'node:fs';
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

  it('index does not import mcp.ts or MCP_MANIFEST', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/from ['"]\.\/mcp['"]/);
    expect(index).not.toContain('MCP_MANIFEST');
  });

  it('parser does not import genres or hono', () => {
    const parser = read('src/parser.ts');
    expect(parser).not.toMatch(/from ['"]\.\/genres['"]/);
    expect(parser).not.toMatch(/from ['"]hono['"]/);
  });

  it('genres module has no default export', () => {
    expect(read('src/genres.ts')).not.toMatch(/export\s+default\b/);
  });

  it('mcp module exports only MCP_MANIFEST const', () => {
    const mcp = read('src/mcp.ts');
    expect(mcp).toMatch(/export const MCP_MANIFEST/);
    expect(mcp).not.toMatch(/export\s+default\b/);
    expect(mcp).not.toMatch(/export\s+function\b/);
  });

  it('types.ts exports only Env interface', () => {
    const types = read('src/types.ts');
    expect(types).toMatch(/export interface Env/);
    expect(types).not.toMatch(/export type /);
    expect(types).not.toMatch(/export const /);
  });

  it('index wires cors() with no options object', () => {
    expect(read('src/index.ts')).toMatch(/app\.use\('\*',\s*cors\(\)\)/);
  });

  it('index IPTV_BASE is https iptv-org categories without trailing slash file', () => {
    expect(read('src/index.ts')).toContain(
      "const IPTV_BASE = 'https://iptv-org.github.io/iptv/categories'",
    );
  });

  it('index does not reference Anthropic OpenAI or Claude model ids', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/anthropic|openai|claude|gpt-4|haiku/i);
  });

  it('parser Station interface fields match push object keys order', () => {
    const parser = read('src/parser.ts');
    const iface = parser.slice(parser.indexOf('export interface Station'), parser.indexOf('export function parseM3U'));
    expect(iface).toMatch(/name:\s*string/);
    expect(iface).toMatch(/url:\s*string/);
    expect(iface).toMatch(/logo\?:\s*string/);
    expect(iface).toMatch(/group\?:\s*string/);
    expect(iface).toMatch(/language\?:\s*string/);
    expect(iface).toMatch(/country\?:\s*string/);
  });

  it('resolveGenre uses VALID_GENRES.includes after map miss', () => {
    expect(read('src/genres.ts')).toContain(
      'return map[lower] ?? (VALID_GENRES.includes(lower as ValidGenre) ? lower : \'music\')',
    );
  });

  it('helpers stub never invents product routes beyond iptv and gemini hosts', () => {
    const helpers = read('test/helpers.ts');
    expect(helpers).not.toContain('/playlist');
    expect(helpers).not.toContain('/now-playing');
    expect(helpers).toContain("url.includes('iptv-org')");
    expect(helpers).toContain("url.includes('generativelanguage.googleapis.com')");
  });

  it('DEPLOY.md Cost Estimate mentions CF Workers free tier and Gemini 2.0 Flash', () => {
    const deploy = read('DEPLOY.md');
    expect(deploy).toMatch(/CF Workers free tier/);
    expect(deploy).toMatch(/Gemini 2\.0 Flash/);
  });

  it('README notes jazz/ambient/classical/pop/rock files 404 fall back to music.m3u', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/fall back to `music\.m3u`/);
    expect(readme).toMatch(/jazz/);
    expect(readme).toMatch(/ambient/);
  });

  it('index degrade maps editorial null not undefined', () => {
    expect(read('src/index.ts')).toContain('editorial: null');
  });

  it('index Gemini fetch uses POST with application/json content-type', () => {
    const index = read('src/index.ts');
    expect(index).toContain("method: 'POST'");
    expect(index).toContain("headers: { 'content-type': 'application/json' }");
  });

});
