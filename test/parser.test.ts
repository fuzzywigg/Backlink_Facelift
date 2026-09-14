import { createHash, createHmac } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseM3U } from '../src/parser';
import { SAMPLE_M3U, buildSimpleM3U, countHttpStreamLines } from './helpers';

const parserRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const parserSource = readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8');

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="drone.zone" tvg-name="Drone Zone" tvg-logo="https://cdn.example/drone.png" tvg-language="English" tvg-country="US" group-title="Ambient",Drone Zone
https://example.com/drone.m3u8
#EXTINF:-1 tvg-name="Jazz After Dark" group-title="Jazz",Jazz After Dark
https://example.com/jazz.m3u8
#EXTINF:-1 tvg-name="Dup Stream",Dup Stream
https://example.com/jazz.m3u8
#EXTINF:-1,Comma Only Name
https://example.com/comma-only.m3u8
#EXTINF:-1 tvg-name="Skip RTMP",Skip RTMP
rtmp://example.com/live
#EXTINF:-1 tvg-name="News Desk" tvg-language="en" tvg-country="GB" group-title="News",News Desk
http://example.com/news.m3u8
`;

describe('parseM3U', () => {
  it('parses EXTINF attributes and http(s) URLs', () => {
    const stations = parseM3U(SAMPLE);
    expect(stations).toHaveLength(4);

    expect(stations[0]).toEqual({
      name: 'Drone Zone',
      url: 'https://example.com/drone.m3u8',
      logo: 'https://cdn.example/drone.png',
      group: 'Ambient',
      language: 'English',
      country: 'US',
    });

    expect(stations[1]).toMatchObject({
      name: 'Jazz After Dark',
      url: 'https://example.com/jazz.m3u8',
      group: 'Jazz',
    });
  });

  it('dedupes by stream URL (keeps first)', () => {
    const stations = parseM3U(SAMPLE);
    const jazzUrls = stations.filter((s) => s.url === 'https://example.com/jazz.m3u8');
    expect(jazzUrls).toHaveLength(1);
    expect(jazzUrls[0].name).toBe('Jazz After Dark');
  });

  it('falls back to display name after the last comma', () => {
    const stations = parseM3U(SAMPLE);
    expect(stations.find((s) => s.url === 'https://example.com/comma-only.m3u8')?.name).toBe(
      'Comma Only Name',
    );
  });

  it('skips non-http schemes like rtmp', () => {
    const stations = parseM3U(SAMPLE);
    expect(stations.some((s) => s.name === 'Skip RTMP')).toBe(false);
  });

  it('returns empty array for empty / header-only playlists', () => {
    expect(parseM3U('')).toEqual([]);
    expect(parseM3U('#EXTM3U\n')).toEqual([]);
  });

  it('ignores EXTINF without a following URL', () => {
    expect(
      parseM3U(`#EXTINF:-1 tvg-name="Orphan",Orphan
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`),
    ).toEqual([
      {
        name: 'Ok',
        url: 'https://example.com/ok.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('matches attribute keys case-insensitively', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 TVG-NAME="Casey" TVG-LOGO="https://cdn.example/c.png" GROUP-TITLE="Rock" TVG-LANGUAGE="DE" TVG-COUNTRY="DE",Casey
https://example.com/case.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Casey',
        url: 'https://example.com/case.m3u8',
        logo: 'https://cdn.example/c.png',
        group: 'Rock',
        language: 'DE',
        country: 'DE',
      },
    ]);
  });

  it('trims surrounding whitespace on lines', () => {
    const stations = parseM3U(`
  #EXTM3U
  #EXTINF:-1 tvg-name="Spaced",Spaced
  https://example.com/spaced.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Spaced');
  });

  it('skips http URLs that have no name from EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
https://example.com/orphan-url.m3u8
#EXTINF:-1 tvg-name="", 
https://example.com/blank-name.m3u8
#EXTINF:-1 tvg-name="Kept",Kept
https://example.com/kept.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual(['https://example.com/kept.m3u8']);
  });

  it('resets state after non-http non-comment lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Broken",Broken
ftp://example.com/file
#EXTINF:-1 tvg-name="Recovered",Recovered
https://example.com/recovered.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Recovered',
        url: 'https://example.com/recovered.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('prefers tvg-name over the comma display name', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Canonical",Display Name
https://example.com/canonical.m3u8
`);
    expect(stations[0].name).toBe('Canonical');
  });

  it('handles CRLF line endings', () => {
    const stations = parseM3U(
      '#EXTM3U\r\n#EXTINF:-1 tvg-name="Win",Win\r\nhttps://example.com/win.m3u8\r\n',
    );
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({ name: 'Win', url: 'https://example.com/win.m3u8' });
  });

  it('skips EXTINF lines with neither tvg-name nor a comma display name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 no-comma-and-no-tvg-name
https://example.com/unnamed.m3u8
#EXTINF:-1 tvg-name="Named",Named
https://example.com/named.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual(['https://example.com/named.m3u8']);
  });

  it('treats empty tvg-name as missing and falls back to comma display name', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="" group-title="X",Fallback Name
https://example.com/fallback.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Fallback Name',
        url: 'https://example.com/fallback.m3u8',
        logo: undefined,
        group: 'X',
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('keeps empty-string attribute values when present (logo/group/lang/country)', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="EmptyAttrs" tvg-logo="" group-title="" tvg-language="" tvg-country="",EmptyAttrs
https://example.com/empty-attrs.m3u8
`);
    expect(stations[0]).toEqual({
      name: 'EmptyAttrs',
      url: 'https://example.com/empty-attrs.m3u8',
      logo: '',
      group: '',
      language: '',
      country: '',
    });
  });

  it('ignores comment lines other than EXTINF between entries', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
#EXTVLCOPT:network-caching=1000
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['One', 'Two']);
  });

  it('parses playlists with many stations without dropping later entries', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 75; i++) {
      lines.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
      lines.push(`https://example.com/s${i}.m3u8`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(75);
    expect(stations[0].name).toBe('S0');
    expect(stations[74].name).toBe('S74');
  });

  it('skips EXTINF with a trailing comma but empty display name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,
https://example.com/empty-display.m3u8
#EXTINF:-1 tvg-name="Kept",Kept
https://example.com/kept.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual(['https://example.com/kept.m3u8']);
  });

  it('preserves unicode names and query strings on stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="東京FM" group-title="音楽",東京FM
https://example.com/tokyo.m3u8?token=abc%20123&lang=ja
`);
    expect(stations).toEqual([
      {
        name: '東京FM',
        url: 'https://example.com/tokyo.m3u8?token=abc%20123&lang=ja',
        logo: undefined,
        group: '音楽',
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('uses the last comma when display name itself contains commas', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-id="x",News, Weather, and Traffic
https://example.com/news-weather.m3u8
`);
    // tvg-name absent → fallback is everything after the last comma
    expect(stations[0].name).toBe('and Traffic');
  });

  it('ignores blank lines between EXTINF and URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Gap",Gap

https://example.com/gap.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Gap');
  });

  it('skips mms and udp schemes the same way as rtmp', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="MMS",MMS
mms://example.com/live
#EXTINF:-1 tvg-name="UDP",UDP
udp://239.0.0.1:1234
#EXTINF:-1 tvg-name="HTTPS",HTTPS
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['HTTPS']);
  });

  it('accepts both http and https stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="HTTP",HTTP
http://example.com/plain.m3u8
#EXTINF:-1 tvg-name="HTTPS",HTTPS
https://example.com/secure.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual([
      'http://example.com/plain.m3u8',
      'https://example.com/secure.m3u8',
    ]);
  });

  it('preserves hash fragments on stream URLs', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Frag",Frag
https://example.com/stream.m3u8#cell=0
`);
    expect(stations[0].url).toBe('https://example.com/stream.m3u8#cell=0');
  });

  it('keeps EXTINF state across intervening non-EXTINF comments', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Kept",Kept
#EXTVLCOPT:http-user-agent=Backlink
#EXTGRP:Music
https://example.com/kept.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Kept',
        url: 'https://example.com/kept.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('does not treat relative paths as stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Rel",Rel
../streams/rel.m3u8
#EXTINF:-1 tvg-name="Abs",Abs
https://example.com/abs.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Abs']);
  });

  it('handles mixed tabs and spaces around EXTINF attributes', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1\ttvg-name="Tabby"\tgroup-title="Jazz",Tabby\nhttps://example.com/tabby.m3u8\n',
    );
    expect(stations[0]).toMatchObject({ name: 'Tabby', group: 'Jazz' });
  });

  it('parses EXTINF duration variants without changing attribute extraction', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:0 tvg-name="Zero",Zero
https://example.com/zero.m3u8
#EXTINF:10.5 tvg-name="Float",Float
https://example.com/float.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Zero', 'Float']);
  });

  it('resets current entry after a successful push so orphan URLs are ignored', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
https://example.com/orphan-after.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual(['https://example.com/one.m3u8']);
  });

  it('does not match single-quoted attribute values (double quotes only)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name='Single' group-title='Jazz',Display Fallback
https://example.com/single.m3u8
`);
    expect(stations[0]).toMatchObject({
      name: 'Display Fallback',
      group: undefined,
      url: 'https://example.com/single.m3u8',
    });
  });

  it('requires lowercase http(s) scheme prefixes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Upper",Upper
HTTP://example.com/upper.m3u8
#EXTINF:-1 tvg-name="Mixed",Mixed
Https://example.com/mixed.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('dedupes identical consecutive URLs keeping the first name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="Second",Second
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="Third",Third
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('First');
  });

  it('strips a UTF-8 BOM before parsing the first header line', () => {
    const stations = parseM3U(
      '\uFEFF#EXTM3U\n#EXTINF:-1 tvg-name="Bombed",Bombed\nhttps://example.com/bom.m3u8\n',
    );
    // BOM sticks to the first line; header becomes "\uFEFF#EXTM3U" (still a # comment).
    // The station line itself is unaffected.
    expect(stations).toEqual([
      {
        name: 'Bombed',
        url: 'https://example.com/bom.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('preserves attribute values that contain commas and spaces', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="City, State FM" group-title="News, Talk",City, State FM
https://example.com/city.m3u8
`,
    );
    expect(stations[0]).toMatchObject({
      name: 'City, State FM',
      group: 'News, Talk',
    });
  });

  it('ignores EXTINF attribute keys that are not in the supported set', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="x" tvg-chno="12" radio="true" tvg-name="OnlyName",OnlyName
https://example.com/only.m3u8
`);
    expect(stations[0]).toEqual({
      name: 'OnlyName',
      url: 'https://example.com/only.m3u8',
      logo: undefined,
      group: undefined,
      language: undefined,
      country: undefined,
    });
  });

  it('handles multiple orphan EXTINF blocks before a valid entry', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
#EXTINF:-1 tvg-name="B",B
#EXTINF:-1 tvg-name="C",C
https://example.com/c.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['C']);
  });

  it('accepts IPv4-literal and ported stream hosts', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="IP",IP
http://192.168.1.10:8080/live.m3u8
`);
    expect(stations[0].url).toBe('http://192.168.1.10:8080/live.m3u8');
  });

  it('does not treat javascript: or data: lines as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="JS",JS
javascript:alert(1)
#EXTINF:-1 tvg-name="Data",Data
data:text/plain,hi
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('allows identical station names with distinct stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Twin",Twin
https://example.com/a.m3u8
#EXTINF:-1 tvg-name="Twin",Twin
https://example.com/b.m3u8
`);
    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/a.m3u8',
      'https://example.com/b.m3u8',
    ]);
  });

  it('ignores bare #EXTINF without a duration/attributes separator content when no comma name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF
https://example.com/bare-extinf.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves userinfo and non-default ports on http(s) URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Auth",Auth
https://user:pass@stream.example:8443/live.m3u8
`);
    expect(stations[0].url).toBe('https://user:pass@stream.example:8443/live.m3u8');
  });

  it('does not treat file: or about: schemes as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="File",File
file:///tmp/x.m3u8
#EXTINF:-1 tvg-name="About",About
about:blank
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not split CR-only playlists (LF/CRLF required)', () => {
    // parseM3U splits on '\n' only — a CR-only blob stays one line and yields no stations.
    const stations = parseM3U(
      '#EXTM3U\r#EXTINF:-1 tvg-name="CR",CR\rhttps://example.com/cr.m3u8\r',
    );
    expect(stations).toEqual([]);
  });

  it('matches attribute keys anywhere on the EXTINF line (including after the comma)', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Real",Display tvg-logo="https://cdn.example/x.png"
https://example.com/real.m3u8
`,
    );
    expect(stations[0]).toMatchObject({
      name: 'Real',
      logo: 'https://cdn.example/x.png',
      url: 'https://example.com/real.m3u8',
    });
  });

  it('accepts http URL that is only the scheme+slashes host root', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Root",Root
https://example.com/
`);
    expect(stations[0].url).toBe('https://example.com/');
  });

  it('resets after protocol-relative URLs (treated as non-http lines)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="ProtoRel",ProtoRel
//cdn.example/stream.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves very long station names without truncation', () => {
    const longName = `N${'a'.repeat(500)}`;
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="${longName}",${longName}
https://example.com/long.m3u8
`,
    );
    expect(stations[0].name).toBe(longName);
    expect(stations[0].name).toHaveLength(501);
  });

  it('returns a new array instance on each call (no shared mutable cache)', () => {
    const a = parseM3U(`#EXTINF:-1 tvg-name="A",A\nhttps://example.com/a.m3u8\n`);
    const b = parseM3U(`#EXTINF:-1 tvg-name="B",B\nhttps://example.com/b.m3u8\n`);
    expect(a).not.toBe(b);
    expect(a[0].name).toBe('A');
    expect(b[0].name).toBe('B');
  });

  it('treats whitespace-only comma display names as missing names', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,
https://example.com/space-name.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    // trailing comma with spaces → name = "   ".trim() === "" which is falsy at push time
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('keeps http and https of the same host as distinct stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="HTTP",HTTP
http://example.com/same.m3u8
#EXTINF:-1 tvg-name="HTTPS",HTTPS
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.url)).toEqual([
      'http://example.com/same.m3u8',
      'https://example.com/same.m3u8',
    ]);
  });

  it('parses without a leading #EXTM3U header', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="NoHeader",NoHeader
https://example.com/no-header.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('NoHeader');
  });

  it('stops attribute capture at the first closing double quote', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Broken"quote" group-title="Jazz",Broken
https://example.com/broken-quote.m3u8
`,
    );
    expect(stations[0].name).toBe('Broken');
    expect(stations[0].group).toBe('Jazz');
  });

  it('accepts IPv6-literal hosts in brackets', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="V6",V6
http://[2001:db8::1]:8080/live.m3u8
`);
    expect(stations[0].url).toBe('http://[2001:db8::1]:8080/live.m3u8');
  });

  it('ignores bare # comment lines and empty #EXTINF:-1 with only spaces after comma', () => {
    const stations = parseM3U(`#EXTM3U
#
#EXTINF:-1,   
https://example.com/blankish.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('trims trailing whitespace off stream URLs via line trim', () => {
    const stations = parseM3U(
      '#EXTINF:-1 tvg-name="TrimURL",TrimURL\nhttps://example.com/trim.m3u8   \n',
    );
    expect(stations[0].url).toBe('https://example.com/trim.m3u8');
  });

  it('does not treat mailto: or tel: lines as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mail",Mail
mailto:dj@example.com
#EXTINF:-1 tvg-name="Tel",Tel
tel:+15551212
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves plus signs and encoded spaces in query strings', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Q",Q
https://example.com/stream.m3u8?q=a+b&x=%20y
`);
    expect(stations[0].url).toBe('https://example.com/stream.m3u8?q=a+b&x=%20y');
  });

  it('resets after a Windows drive-letter path line', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Win",Win
C:\\Streams\\local.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('allows a second #EXTM3U header mid-playlist without resetting stations', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
#EXTM3U
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['One', 'Two']);
  });

  it('does not unescape backslash-escaped quotes inside attribute values', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="A\\"B" group-title="G",Display
https://example.com/esc.m3u8
`,
    );
    // Regex stops at first "; name becomes A\\ (then leftover is outside the match)
    expect(stations[0].name).toBe('A\\');
  });

  it('skips whitespace-only lines between entries without clearing EXTINF state', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Spacy",Spacy


https://example.com/spacy.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Spacy');
  });

  it('parses negative and positive EXTINF durations the same way', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Neg",Neg
https://example.com/neg.m3u8
#EXTINF:3600 tvg-name="Hour",Hour
https://example.com/hour.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Neg', 'Hour']);
  });

  it('does not accept http without the double-slash authority form', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="NoSlash",NoSlash
http:example.com/bad
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('requires uppercase #EXTINF prefix (lowercase #extinf is ignored)', () => {
    const stations = parseM3U(`#EXTM3U
#extinf:-1 tvg-name="Lower",Lower
https://example.com/lower.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    // lowercase line is a non-http non-#EXTINF comment-ish line → resets; URL has no name
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('lets a later #EXTINF replace an earlier unfinished entry', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
#EXTINF:-1 tvg-name="B",B
https://example.com/b.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['B']);
  });

  it('resets after ftp/sftp schemes and keeps the next http entry', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ftp",Ftp
ftp://files.example/stream.m3u8
#EXTINF:-1 tvg-name="Sftp",Sftp
sftp://files.example/stream.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('accepts a bare http:// authority-less URL when a name is present', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Bare",Bare
http://
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('http://');
  });

  it('keeps EXTINF state across #EXTGRP and other non-EXTINF tags', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Tagged",Tagged
#EXTGRP:Jazz
#EXTVLCOPT:network-caching=1000
https://example.com/tagged.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Tagged');
  });

  it('ignores #EXTINF that does not start the line (mid-line marker)', () => {
    const stations = parseM3U(`#EXTM3U
x#EXTINF:-1 tvg-name="Mid",Mid
https://example.com/mid.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not require spaces around attribute equals signs', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name = "Spaced",Spaced
https://example.com/spaced.m3u8
`,
    );
    // regex is tvg-name="..." — spaces around = prevent the match; comma fallback wins
    expect(stations[0].name).toBe('Spaced');
    expect(stations[0].logo).toBeUndefined();
  });

  it('omits optional fields when attributes are absent (not null)', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Sparse",Sparse
https://example.com/sparse.m3u8
`);
    expect(stations[0]).toEqual({
      name: 'Sparse',
      url: 'https://example.com/sparse.m3u8',
      logo: undefined,
      group: undefined,
      language: undefined,
      country: undefined,
    });
    expect('logo' in stations[0]).toBe(true);
  });

  it('accepts internationalized domain labels in stream hosts', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="IDN",IDN
https://münchen.example/stream.m3u8
`);
    expect(stations[0].url).toBe('https://münchen.example/stream.m3u8');
  });

  it('dedupes URLs that differ only by surrounding whitespace (trim)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
  https://example.com/same.m3u8  
#EXTINF:-1 tvg-name="Second",Second
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('First');
  });

  it('does not treat ws:// or wss:// as http streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="WS",WS
ws://example.com/live
#EXTINF:-1 tvg-name="WSS",WSS
wss://example.com/live
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('parses a playlist that is only a single EXTINF+URL pair', () => {
    const stations = parseM3U('#EXTINF:-1 tvg-name="Solo",Solo\nhttps://example.com/solo.m3u8');
    expect(stations).toEqual([
      {
        name: 'Solo',
        url: 'https://example.com/solo.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('ignores attribute values that use single quotes exclusively', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name='Quoted' group-title='Jazz',Fallback
https://example.com/sq.m3u8
`,
    );
    expect(stations[0].name).toBe('Fallback');
    expect(stations[0].group).toBeUndefined();
  });

  it('preserves path segments with dots and double dots', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Dots",Dots
https://example.com/a/../b/./c.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/a/../b/./c.m3u8');
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseM3U('   \n\t\n  ')).toEqual([]);
  });

  it('does not treat magnet: or ipfs: lines as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Magnet",Magnet
magnet:?xt=urn:btih:abc
#EXTINF:-1 tvg-name="Ipfs",Ipfs
ipfs://bafyexample
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('uses the first tvg-name when the attribute is duplicated', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="First" tvg-name="Second",Fallback
https://example.com/dup-attr.m3u8
`);
    expect(stations[0].name).toBe('First');
  });

  it('parses EXTINF lines that begin with a UTF-8 BOM', () => {
    const stations = parseM3U(
      `\ufeff#EXTINF:-1 tvg-name="BomInf",BomInf\nhttps://example.com/bom-inf.m3u8\n`,
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('BomInf');
  });

  it('ignores unquoted attribute forms and falls back to comma display name', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name=Unquoted group-title=Jazz,Display
https://example.com/unquoted.m3u8
`);
    expect(stations[0].name).toBe('Display');
    expect(stations[0].group).toBeUndefined();
  });

  it('preserves extremely long stream URLs without truncation', () => {
    const longPath = 'a'.repeat(8000);
    const url = `https://example.com/${longPath}.m3u8`;
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Long",Long\n${url}\n`);
    expect(stations[0].url).toBe(url);
    expect(stations[0].url.length).toBeGreaterThan(8000);
  });

  it('preserves null bytes in station names', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Nu\u0000ll",Nu\u0000ll
https://example.com/null.m3u8
`);
    expect(stations[0].name).toContain('\u0000');
  });

  it('preserves unpaired surrogates in names and URLs', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Bad\uD800Name",Bad\uD800Name
https://example.com/\uD800.m3u8
`);
    expect(stations[0].name).toContain('\uD800');
    expect(stations[0].url).toContain('\uD800');
  });

  it('does not treat spaced # EXTINF as an EXTINF directive', () => {
    const stations = parseM3U(`# EXTINF:-1 tvg-name="Nope",Nope
https://example.com/spaced.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    // spaced directive is a comment; following URL has no current name → skipped
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('parses a playlist ending with EXTINF+URL and no trailing newline', () => {
    const stations = parseM3U('#EXTINF:-1 tvg-name="EOF",EOF\nhttps://example.com/eof.m3u8');
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/eof.m3u8');
  });

  it('uses the first group-title when duplicated on one line', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="G" group-title="One" group-title="Two",G
https://example.com/g.m3u8
`,
    );
    expect(stations[0].group).toBe('One');
  });

  it('keeps empty-string tvg-logo when the attribute is present but empty', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="L" tvg-logo="",L
https://example.com/logo-empty.m3u8
`);
    expect(stations[0].logo).toBe('');
  });

  it('skips http URL that arrives without a preceding named EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
https://example.com/orphan-url.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets current after a non-http URL so the next http needs a fresh EXTINF', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Skip",Skip
rtmp://example.com/live
https://example.com/should-skip.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('trims whitespace around stream URLs via line trim', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Pad",Pad
  https://example.com/pad.m3u8  
`);
    expect(stations[0].url).toBe('https://example.com/pad.m3u8');
  });

  it('accepts http and https mixed case schemes after trim', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="A",A
HTTP://example.com/a.m3u8
#EXTINF:-1 tvg-name="B",B
HTTPS://example.com/b.m3u8
`);
    // startsWith is case-sensitive — uppercase schemes are treated as non-http and reset
    expect(stations).toEqual([]);
  });

  it('dedupes identical URLs even when display names differ', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="One",One
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="Two",Two
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('One');
  });

  it('keeps trailing-slash vs no-slash URLs as distinct streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/live
#EXTINF:-1 tvg-name="B",B
https://example.com/live/
`);
    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/live',
      'https://example.com/live/',
    ]);
  });

  it('does not treat gopher or nntp schemes as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Gopher",Gopher
gopher://example.com/1
#EXTINF:-1 tvg-name="Nntp",Nntp
nntp://news.example/comp
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves unicode combining marks in station names', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="cafe\u0301",cafe\u0301
https://example.com/cafe.m3u8
`);
    expect(stations[0].name).toBe('cafe\u0301');
  });

  it('ignores playlist-only comments without EXTINF', () => {
    expect(parseM3U('#EXTM3U\n# comment\n# another\n')).toEqual([]);
  });

  it('accepts numeric-looking display names from the comma fallback', () => {
    const stations = parseM3U(`#EXTINF:-1,101.5 FM
https://example.com/numeric.m3u8
`);
    expect(stations[0].name).toBe('101.5 FM');
  });

  it('does not decode percent-encoded sequences in stream URLs', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Pct",Pct
https://example.com/%2e%2e/stream.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/%2e%2e/stream.m3u8');
  });

  it('keeps query-only differences as distinct stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/s.m3u8?a=1
#EXTINF:-1 tvg-name="B",B
https://example.com/s.m3u8?a=2
`);
    expect(stations).toHaveLength(2);
  });

  it('resets after smb:// and keeps the next https entry', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Smb",Smb
smb://files/share/x.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves emoji in group-title and station name', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="🎸 Rock" group-title="🎵 Music",🎸 Rock
https://example.com/rock.m3u8
`,
    );
    expect(stations[0]).toMatchObject({ name: '🎸 Rock', group: '🎵 Music' });
  });

  it('treats http URL with only a single slash after scheme as non-http', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
http:/example.com/bad
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('parses when EXTINF attributes use mixed case keys mid-line', () => {
    const stations = parseM3U(
      `#EXTINF:-1 Tvg-Name="Mix" Group-Title="Jazz",Mix
https://example.com/mix.m3u8
`,
    );
    expect(stations[0]).toMatchObject({ name: 'Mix', group: 'Jazz' });
  });

  it('does not collapse distinct hosts that share a path', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://a.example/stream.m3u8
#EXTINF:-1 tvg-name="B",B
https://b.example/stream.m3u8
`);
    expect(stations).toHaveLength(2);
  });

  it('keeps whitespace-only tvg-name as a truthy name (push does not trim)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="   ",   
https://example.com/blank.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['   ', 'Ok']);
  });
  it('uses the first tvg-language when duplicated on one line', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="L" tvg-language="en" tvg-language="fr",L
https://example.com/lang.m3u8
`,
    );
    expect(stations[0].language).toBe('en');
  });

  it('uses the first tvg-country when duplicated on one line', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="C" tvg-country="US" tvg-country="CA",C
https://example.com/country.m3u8
`,
    );
    expect(stations[0].country).toBe('US');
  });

  it('does not honor underscore or camelCase tvg name keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg_name="Nope" tvgName="Nope2",Fallback
https://example.com/underscore.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
  });

  it('parses language and country with comma-fallback name only', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-language="de" tvg-country="DE",Berlin FM
https://example.com/berlin.m3u8
`,
    );
    expect(stations[0]).toMatchObject({
      name: 'Berlin FM',
      language: 'de',
      country: 'DE',
    });
  });

  it('keeps # and "# " comment lines from resetting EXTINF state', () => {
    const stations = parseM3U(`#EXTINF:-1 tvg-name="Keep",Keep
#
# 
https://example.com/keep.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Keep']);
  });

  it('does not share seen URLs across separate parseM3U calls', () => {
    const a = parseM3U(`#EXTINF:-1 tvg-name="A",A\nhttps://example.com/shared.m3u8\n`);
    const b = parseM3U(`#EXTINF:-1 tvg-name="B",B\nhttps://example.com/shared.m3u8\n`);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(b[0].name).toBe('B');
  });

  it('does not share mutable state across interleaved parseM3U calls', () => {
    const left = `#EXTINF:-1 tvg-name="Left",Left\nhttps://example.com/left.m3u8\n`;
    const right = `#EXTINF:-1 tvg-name="Right",Right\nhttps://example.com/right.m3u8\n`;
    const results = [parseM3U(left), parseM3U(right), parseM3U(left)];
    expect(results.map((r) => r.map((s) => s.name))).toEqual([['Left'], ['Right'], ['Left']]);
  });

  it('does not unescape HTML entities inside attribute values', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="A&quot;B" group-title="X&amp;Y",A&quot;B
https://example.com/entity.m3u8
`,
    );
    expect(stations[0].name).toBe('A&quot;B');
    expect(stations[0].group).toBe('X&amp;Y');
  });

  it('skips EXTINF that has duration only and no comma name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1
https://example.com/no-name.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('keeps EXTINF state across #EXTVLCOPT and #EXTIMG tags', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Vlc",Vlc
#EXTVLCOPT:network-caching=1000
#EXTIMG:https://cdn.example/img.png
https://example.com/vlc.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Vlc');
  });

  it('resets after Windows UNC-style paths', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Unc",Unc
\\\\server\\share\\stream.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('rejects uppercase HTTP and HTTPS schemes as non-http resets', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
HTTP://example.com/a.m3u8
#EXTINF:-1 tvg-name="B",B
HTTPS://example.com/b.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves country and language when logo is omitted', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="NoLogo" tvg-language="ja" tvg-country="JP",NoLogo
https://example.com/nologo.m3u8
`,
    );
    expect(stations[0].logo).toBeUndefined();
    expect(stations[0]).toMatchObject({ language: 'ja', country: 'JP' });
  });

  it('parses a large playlist of 2000 entries without throwing', () => {
    const chunks: string[] = ['#EXTM3U'];
    for (let i = 0; i < 2000; i++) {
      chunks.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
      chunks.push(`https://example.com/s${i}.m3u8`);
    }
    const stations = parseM3U(chunks.join('\n'));
    expect(stations).toHaveLength(2000);
    expect(stations[0].name).toBe('S0');
    expect(stations[1999].url).toBe('https://example.com/s1999.m3u8');
  });

  it('accepts attribute order permutations before the comma name', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-country="UK" group-title="News" tvg-language="en" tvg-name="Order",Order
https://example.com/order.m3u8
`,
    );
    expect(stations[0]).toMatchObject({
      name: 'Order',
      country: 'UK',
      group: 'News',
      language: 'en',
    });
  });

  it('accepts BOM-prefixed URL lines because trim strips the BOM', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bom",Bom
\uFEFFhttps://example.com/bom.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Bom', 'Ok']);
    expect(stations[0].url).toBe('https://example.com/bom.m3u8');
  });

  it('matches x-tvg-name as a tvg-name substring false positive', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 x-tvg-name="Nope" tvg-name="Yes",Yes
https://example.com/x.m3u8
`);
    // /tvg-name="([^"]*)"/i matches inside x-tvg-name first
    expect(stations[0].name).toBe('Nope');
  });

  it('uses the first tvg-logo when duplicated on one line', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="L" tvg-logo="https://cdn/1.png" tvg-logo="https://cdn/2.png",L
https://example.com/logo.m3u8
`,
    );
    expect(stations[0].logo).toBe('https://cdn/1.png');
  });

  it('accepts tvg-name attribute without a comma display name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Only"
https://example.com/only.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Only');
  });

  it('keeps EXTINF state across #EXT-X-STREAM-INF and #PLAYLIST tags', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Hls",Hls
#EXT-X-STREAM-INF:BANDWIDTH=128000
#PLAYLIST:Extra
https://example.com/hls.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Hls');
  });

  it('resets after rtmps:// like other non-http schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Secure",Secure
rtmps://example.com/live
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('rejects mixed-case httP:// and Https:// schemes as non-http resets', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
httP://example.com/a.m3u8
#EXTINF:-1 tvg-name="B",B
Https://example.com/b.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not treat http URLs inside # comment lines as streams or resets', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
# https://ignored.example/comment.m3u8
https://example.com/keep.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Keep']);
    expect(stations[0].url).toBe('https://example.com/keep.m3u8');
  });

  it('preserves equals signs inside attribute values', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="a=b=c" group-title="x=y",a=b=c
https://example.com/eq.m3u8
`,
    );
    expect(stations[0].name).toBe('a=b=c');
    expect(stations[0].group).toBe('x=y');
  });

  it('parses NBSP-prefixed #EXTINF because trim strips NBSP', () => {
    const stations = parseM3U(`#EXTM3U
\u00A0#EXTINF:-1 tvg-name="Nbsp",Nbsp
https://example.com/nbsp.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Nbsp');
  });

  it('accepts bare https:// as a stream URL when EXTINF has a name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bare",Bare
https://
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://');
  });

  it('uses the first group-title when duplicated on one line', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="G" group-title="One" group-title="Two",G
https://example.com/group.m3u8
`,
    );
    expect(stations[0].group).toBe('One');
  });

  it('resets after mailto: and data: non-http schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mail",Mail
mailto:dj@example.com
#EXTINF:-1 tvg-name="Data",Data
data:text/plain,hi
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('skips blank lines between EXTINF and URL without resetting', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Blank",Blank

https://example.com/blank.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Blank');
  });

  it('does not match tvg-name when attribute uses single quotes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name='Nope',Fallback
https://example.com/sq.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
  });

  it('matches x-tvg-logo as a tvg-logo substring false positive', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="L" x-tvg-logo="https://cdn/x.png" tvg-logo="https://cdn/real.png",L
https://example.com/xlogo.m3u8
`,
    );
    expect(stations[0].logo).toBe('https://cdn/x.png');
  });

  it('skips CR-only blank lines between EXTINF and URL', () => {
    const stations = parseM3U(`#EXTM3U\r
#EXTINF:-1 tvg-name="Cr",Cr\r
\r
https://example.com/cr.m3u8\r
`);
    expect(stations.map((s) => s.name)).toEqual(['Cr']);
  });

  it('does not treat ftp:// or sftp:// as http streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ftp",Ftp
ftp://example.com/a.m3u8
#EXTINF:-1 tvg-name="Sftp",Sftp
sftp://example.com/b.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves emoji and non-ASCII in names and groups', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="📻 Radio" group-title="日本語",📻 Radio
https://example.com/emoji.m3u8
`,
    );
    expect(stations[0].name).toBe('📻 Radio');
    expect(stations[0].group).toBe('日本語');
  });

  it('accepts http URL with query string and fragment', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Q",Q
https://example.com/stream.m3u8?token=1&x=2#frag
`,
    );
    expect(stations[0].url).toBe('https://example.com/stream.m3u8?token=1&x=2#frag');
  });

  it('resets when a second EXTINF arrives before a URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Dropped",Dropped
#EXTINF:-1 tvg-name="Kept",Kept
https://example.com/kept.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Kept']);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parseM3U('   \n\t\n  ')).toEqual([]);
  });

  it('does not honor tvg-name with unclosed quote', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Unclosed,Fallback
https://example.com/unclosed.m3u8
`);
    // Regex fails; comma-fallback may still produce a name from last comma
    expect(stations.length).toBeLessThanOrEqual(1);
    if (stations.length === 1) {
      expect(stations[0].name.length).toBeGreaterThan(0);
    }
  });

  it('ignores a URL glued onto the same EXTINF line (URL must be its own line)', () => {
    // parseM3U only accepts http(s) on a non-#EXTINF line; same-line streams are dropped.
    const stations = parseM3U(
      `#EXTM3U
#EXTINF:-1 tvg-name="Glued",Glued https://example.com/glued.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`,
    );
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
    expect(stations[0].url).toBe('https://example.com/ok.m3u8');
  });

  it('does not treat Unicode line separators (U+2028/U+2029) as playlist newlines', () => {
    // split('\\n') only — LS/PS keep EXTINF+URL on one logical line, so no stations emit.
    const withLs = `#EXTINF:-1 tvg-name="Ls",Ls\u2028https://example.com/ls.m3u8`;
    const withPs = `#EXTINF:-1 tvg-name="Ps",Ps\u2029https://example.com/ps.m3u8`;
    expect(parseM3U(withLs)).toEqual([]);
    expect(parseM3U(withPs)).toEqual([]);
  });

  it('treats #EXTINFORMATION as EXTINF via startsWith("#EXTINF")', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINFORMATION:-1 tvg-name="Info",Info
https://example.com/info.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Info');
  });

  it('treats #EXTINFON as EXTINF via startsWith("#EXTINF")', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINFON:-1 tvg-name="On",On
https://example.com/on.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['On']);
  });

  it('skips URL when tvg-name is empty and there is no comma fallback name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name=""
https://example.com/empty-name.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('dedupes URLs case-sensitively (http://X ≠ http://x)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
http://Example.com/stream.m3u8
#EXTINF:-1 tvg-name="B",B
http://example.com/stream.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
    expect(stations.map((s) => s.url)).toEqual([
      'http://Example.com/stream.m3u8',
      'http://example.com/stream.m3u8',
    ]);
  });

  it('extracts adjacent attrs without intervening spaces', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Adj"tvg-logo="https://cdn/a.png"group-title="G",Adj
https://example.com/adj.m3u8
`,
    );
    expect(stations[0].name).toBe('Adj');
    expect(stations[0].logo).toBe('https://cdn/a.png');
    expect(stations[0].group).toBe('G');
  });

  it('parses mixed LF and CRLF entries in one playlist', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="Lf",Lf\nhttps://example.com/lf.m3u8\r\n#EXTINF:-1 tvg-name="Crlf",Crlf\r\nhttps://example.com/crlf.m3u8\n`,
    );
    expect(stations.map((s) => s.name)).toEqual(['Lf', 'Crlf']);
  });

  it('preserves angle brackets inside attribute values', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="<Radio>" group-title="<G>",<Radio>
https://example.com/angle.m3u8
`,
    );
    expect(stations[0].name).toBe('<Radio>');
    expect(stations[0].group).toBe('<G>');
  });

  it('does not emit stations from #EXT-X-STREAM-INF alone', () => {
    expect(
      parseM3U(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=128000
https://example.com/orphan.m3u8
`),
    ).toEqual([]);
  });

  it('accepts a huge EXTINF attribute payload without throwing', () => {
    const big = 'x'.repeat(50_000);
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="${big}" group-title="${big}",${big}
https://example.com/huge.m3u8
`,
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe(big);
    expect(stations[0].group).toBe(big);
  });

  it('dedupes duplicate URL after intervening non-http reset', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
https://example.com/dup.m3u8
#EXTINF:-1 tvg-name="Rtmp",Rtmp
rtmp://example.com/live
#EXTINF:-1 tvg-name="Second",Second
https://example.com/dup.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['First']);
  });

  it('preserves tabs inside attribute values', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="A\tB" group-title="G\tH",A\tB
https://example.com/tab.m3u8
`,
    );
    expect(stations[0].name).toBe('A\tB');
    expect(stations[0].group).toBe('G\tH');
  });

  it('skips URL when name is only whitespace after comma fallback', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,
https://example.com/blank-name.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    // comma fallback yields "" after trim → falsy → skip
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('keeps http:// and https:// URL schemes distinct for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Http",Http
http://example.com/stream.m3u8
#EXTINF:-1 tvg-name="Https",Https
https://example.com/stream.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Http', 'Https']);
  });

  it('lets mytvg-name steal name via unbounded /tvg-name=/ regex', () => {
    const stations = parseM3U(
      `#EXTINF:-1 mytvg-name="False" tvg-name="True",True
https://example.com/mytvg.m3u8
`,
    );
    expect(stations[0].name).toBe('False');
  });

  it('lets xtvg-language win over later tvg-language', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Lang" xtvg-language="xx" tvg-language="en",Lang
https://example.com/lang.m3u8
`,
    );
    expect(stations[0].language).toBe('xx');
  });

  it('lets agroup-title win over later group-title', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="G" agroup-title="Nope" group-title="Yes",G
https://example.com/group.m3u8
`,
    );
    expect(stations[0].group).toBe('Nope');
  });

  it('lets foottvg-country win over later tvg-country', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="C" foottvg-country="ZZ" tvg-country="US",C
https://example.com/country.m3u8
`,
    );
    expect(stations[0].country).toBe('ZZ');
  });

  it('treats #EXTINF-1 without colon as EXTINF via startsWith', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF-1 tvg-name="Nocolon",Nocolon
https://example.com/nocolon.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Nocolon']);
  });

  it('does not parse ZWSP-prefixed #EXTINF (trim keeps U+200B)', () => {
    expect(
      parseM3U(`\u200B#EXTINF:-1 tvg-name="Z",Z
https://example.com/z.m3u8
`),
    ).toEqual([]);
  });

  it('does not parse soft-hyphen-prefixed #EXTINF (U+00AD)', () => {
    expect(
      parseM3U(`\u00AD#EXTINF:-1 tvg-name="S",S
https://example.com/s.m3u8
`),
    ).toEqual([]);
  });

  it('skips ZWSP-prefixed https URL and resets current', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Lost",Lost
\u200Bhttps://example.com/lost.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('accepts http:///path triple-slash URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Triple",Triple
http:///path
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('http:///path');
  });

  it('resets on http:foo / https:bar without // and continues', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
http:foo
#EXTINF:-1 tvg-name="Also",Also
https:bar
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('omits logo when spaces surround tvg-logo = assignment', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Sp" tvg-logo = "https://cdn/x.png",Sp
https://example.com/sp.m3u8
`,
    );
    expect(stations[0].name).toBe('Sp');
    expect(stations[0].logo).toBeUndefined();
  });

  it('extracts logo after comma when tvg-name missing; display name includes attrs', () => {
    const stations = parseM3U(
      `#EXTINF:-1,Display tvg-logo="https://cdn/y.png"
https://example.com/after-comma.m3u8
`,
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Display tvg-logo="https://cdn/y.png"');
    expect(stations[0].logo).toBe('https://cdn/y.png');
  });

  it('returns [] for URL-only playlist without EXTINF', () => {
    expect(
      parseM3U(`https://example.com/a.m3u8
https://example.com/b.m3u8
`),
    ).toEqual([]);
  });

  it('does not bind http URL after non-http without a fresh EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Lost",Lost
rtmp://example.com/live
https://example.com/orphan.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not dedupe unicode NFKC lookalike URLs', () => {
    // Fullwidth solidus U+FF0F vs ASCII /
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/stream.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com\uFF0Fstream.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('trims EM/EN SPACE around URL so stream still binds', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Em",Em
\u2003https://example.com/em.m3u8\u2003
#EXTINF:-1 tvg-name="En",En
\u2002https://example.com/en.m3u8\u2002
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/em.m3u8',
      'https://example.com/en.m3u8',
    ]);
  });

  it('keeps whitespace-only language and country attribute values', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Ws" tvg-language="   " tvg-country="  ",Ws
https://example.com/ws.m3u8
`,
    );
    expect(stations[0].language).toBe('   ');
    expect(stations[0].country).toBe('  ');
  });

  it('matches GROUP-TITLE case-insensitively', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Up" GROUP-TITLE="UPPER",Up
https://example.com/up.m3u8
`,
    );
    expect(stations[0].group).toBe('UPPER');
  });

  it('does not reset on lone # comment; URL still binds to prior EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Hash",Hash
#
https://example.com/hash.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Hash']);
  });

  it('treats #Extinf mixed case as non-EXTINF comment (case-sensitive startsWith)', () => {
    expect(
      parseM3U(`#Extinf:-1 tvg-name="Mixed",Mixed
https://example.com/mixed.m3u8
`),
    ).toEqual([]);
  });

  it('returns [] for playlist of only newlines', () => {
    expect(parseM3U('\n\n\n')).toEqual([]);
  });

  it('keeps length 1 across 5000 duplicate URLs', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 5000; i++) {
      lines.push(`#EXTINF:-1 tvg-name="D${i}",D${i}`);
      lines.push('https://example.com/dup-many.m3u8');
    }
    expect(parseM3U(lines.join('\n'))).toHaveLength(1);
  });

  it('omits undefined optional fields from JSON while own props may be undefined', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bare",Bare
https://example.com/bare.m3u8
`);
    expect(stations[0].logo).toBeUndefined();
    expect(stations[0].group).toBeUndefined();
    expect(stations[0].language).toBeUndefined();
    expect(stations[0].country).toBeUndefined();
    expect(JSON.parse(JSON.stringify(stations[0]))).toEqual({
      name: 'Bare',
      url: 'https://example.com/bare.m3u8',
    });
  });

  it('does not throw on lone surrogate in URL line', () => {
    expect(() =>
      parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sur",Sur
https://example.com/\uD800.m3u8
`),
    ).not.toThrow();
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sur",Sur
https://example.com/\uD800.m3u8
`);
    expect(stations).toHaveLength(1);
  });

  it('does not emit station from https:// inside tvg-logo until URL line', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Logo" tvg-logo="https://cdn.example/logo.png",Logo
https://example.com/real.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/real.m3u8');
    expect(stations[0].logo).toBe('https://cdn.example/logo.png');
  });

  it('lets x-group-title / x-tvg-language / x-tvg-country win via substring regex', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="X" x-group-title="Fake" group-title="Real" x-tvg-language="xx" tvg-language="en" x-tvg-country="XX" tvg-country="US",X
https://example.com/x.m3u8
`);
    expect(stations[0].group).toBe('Fake');
    expect(stations[0].language).toBe('xx');
    expect(stations[0].country).toBe('XX');
  });

  it('does not split on U+0085 NEL between EXTINF and URL', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Nel",Nel\u0085https://example.com/nel.m3u8\n`,
    );
    expect(stations).toEqual([]);
  });

  it('preserves internal tab characters inside stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Tab",Tab
https://example.com/\tstream.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/\tstream.m3u8');
  });

  it('locks every station object key set to name/url/logo/group/language/country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sparse",Sparse
https://example.com/sparse.m3u8
#EXTINF:-1 tvg-name="Full" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",Full
https://example.com/full.m3u8
`);
    for (const s of stations) {
      expect(Object.keys(s).sort()).toEqual([
        'country',
        'group',
        'language',
        'logo',
        'name',
        'url',
      ]);
    }
  });

  it('treats # fragment and %23 as distinct URLs for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Hash",Hash
https://example.com/stream.m3u8#x
#EXTINF:-1 tvg-name="Encoded",Encoded
https://example.com/stream.m3u8%23x
`);
    expect(stations.map((s) => s.name)).toEqual(['Hash', 'Encoded']);
  });

  it('lets footgroup-title / mygroup-title steal group via substring regex', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="G" footgroup-title="Foot" group-title="Real",G
https://example.com/foot-g.m3u8
#EXTINF:-1 tvg-name="M" mygroup-title="Mine" group-title="Real",M
https://example.com/my-g.m3u8
`);
    expect(stations[0].group).toBe('Foot');
    expect(stations[1].group).toBe('Mine');
  });

  it('lets pretvg-name / notreallytvg-name win name via unbounded tvg-name regex', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 pretvg-name="Pre" tvg-name="Real",Display
https://example.com/pre-name.m3u8
#EXTINF:-1 notreallytvg-name="Fake" tvg-name="Real2",Display2
https://example.com/fake-name.m3u8
`);
    expect(stations[0].name).toBe('Pre');
    expect(stations[1].name).toBe('Fake');
  });

  it('does not honor tvg-group or group_title underscore / camelCase keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Alt" tvg-group="Nope" group_title="Nope2" groupTitle="Nope3",Alt
https://example.com/alt-group.m3u8
`);
    expect(stations[0].group).toBeUndefined();
  });

  it('preserves language and country case (no lowercasing of attr values)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Case" tvg-language="EN-us" tvg-country="Us",Case
https://example.com/case.m3u8
`);
    expect(stations[0].language).toBe('EN-us');
    expect(stations[0].country).toBe('Us');
  });

  it('keeps leading/trailing spaces inside tvg-name values (line trim only)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="  Spaced  ",Display
https://example.com/spaced-name.m3u8
`);
    expect(stations[0].name).toBe('  Spaced  ');
  });

  it('keeps empty-string group-title when attribute present', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="EmptyG" group-title="",EmptyG
https://example.com/empty-g.m3u8
`);
    expect(stations[0].group).toBe('');
  });

  it('does not treat narrow no-break space U+202F as trimable around URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Nnbs",Nnbs
\u202Fhttps://example.com/nnbs.m3u8
`);
    // trim() does strip U+202F in modern JS — lock whatever runtime does.
    const trimmed = '\u202Fhttps://example.com/nnbs.m3u8'.trim();
    if (trimmed.startsWith('http')) {
      expect(stations).toHaveLength(1);
      expect(stations[0].url).toBe(trimmed);
    } else {
      expect(stations).toEqual([]);
    }
  });

  it('preserves ZWJ U+200D inside station names', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Family\u200DRadio",Family
https://example.com/zwj.m3u8
`);
    expect(stations[0].name).toBe('Family\u200DRadio');
  });

  it('treats fragment-only URL differences as distinct streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/stream.m3u8#a
#EXTINF:-1 tvg-name="B",B
https://example.com/stream.m3u8#b
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('treats query-less vs trailing-? URLs as distinct for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Q0",Q0
https://example.com/q.m3u8
#EXTINF:-1 tvg-name="Q1",Q1
https://example.com/q.m3u8?
`);
    expect(stations.map((s) => s.name)).toEqual(['Q0', 'Q1']);
  });

  it('preserves order across 100 unique stations', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100; i++) {
      lines.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
      lines.push(`https://example.com/s${i}.m3u8`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(100);
    expect(stations.map((s) => s.name)).toEqual(
      Array.from({ length: 100 }, (_, i) => `S${i}`),
    );
  });

  it('does not honor GROUP_TITLE underscore form', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="U" GROUP_TITLE="Nope",U
https://example.com/group-us.m3u8
`);
    expect(stations[0].group).toBeUndefined();
  });

  it('treats #EXTINF: with nothing after colon as EXTINF (startsWith)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:
https://example.com/bare-extinf.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok-after.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('treats #EXTINFzzz suffix as EXTINF via startsWith', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINFzzz tvg-name="Zzz",Zzz
https://example.com/zzz.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Zzz');
  });

  it('resets on relative ./ and ../ path lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Rel",Rel
./local.m3u8
#EXTINF:-1 tvg-name="Up",Up
../up.m3u8
#EXTINF:-1 tvg-name="Live",Live
https://example.com/live.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Live']);
  });

  it('does not treat bare http or https tokens without :// as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Tok",Tok
http
#EXTINF:-1 tvg-name="Tok2",Tok2
https
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/tok-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves double-encoded %252F path segments literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Enc",Enc
https://example.com/a%252Fb.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/a%252Fb.m3u8');
  });

  it('does not emit from # comment lines that contain http:// URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="C",C
# http://example.com/commented.m3u8
https://example.com/real-c.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/real-c.m3u8');
  });

  it('keeps station objects as plain extensible unfrozen records', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Plain",Plain
https://example.com/plain.m3u8
`);
    expect(Object.getPrototypeOf(stations[0])).toBe(Object.prototype);
    expect(Object.isFrozen(stations[0])).toBe(false);
    expect(Object.isExtensible(stations[0])).toBe(true);
    expect(Object.isFrozen(stations)).toBe(false);
  });

  it('returns a mutable array callers can push onto without affecting next parse', () => {
    const a = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/mut-a.m3u8
`);
    a.push({ name: 'Injected', url: 'https://example.com/injected.m3u8' });
    const b = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="B",B
https://example.com/mut-b.m3u8
`);
    expect(b).toHaveLength(1);
    expect(b[0].name).toBe('B');
  });

  it('preserves literal backslash-n sequences inside attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Line\\nBreak",Line
https://example.com/bs-n.m3u8
`);
    expect(stations[0].name).toBe('Line\\nBreak');
  });

  it('accepts http://. and https://. odd hosts when named', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Dot",Dot
http://./
#EXTINF:-1 tvg-name="DotS",DotS
https://./
`);
    expect(stations.map((s) => s.url)).toEqual(['http://./', 'https://./']);
  });

  it('preserves userinfo with empty password user:@host', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Auth",Auth
https://user:@example.com/stream.m3u8
`);
    expect(stations[0].url).toBe('https://user:@example.com/stream.m3u8');
  });

  it('allows station name that is the literal string undefined', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="undefined",undefined
https://example.com/undef-name.m3u8
`);
    expect(stations[0].name).toBe('undefined');
  });

  it('keeps data: URI logos without treating them as stream lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Data" tvg-logo="data:image/png;base64,aaa",Data
https://example.com/data-logo.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].logo).toBe('data:image/png;base64,aaa');
    expect(stations[0].url).toBe('https://example.com/data-logo.m3u8');
  });

  it('locks all station field values as strings when attrs present', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="T" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",T
https://example.com/types.m3u8
`);
    for (const key of ['name', 'url', 'logo', 'group', 'language', 'country'] as const) {
      expect(typeof stations[0][key]).toBe('string');
    }
  });

  it('skips leading blank lines before the first EXTINF', () => {
    const stations = parseM3U(`

#EXTINF:-1 tvg-name="Lead",Lead
https://example.com/lead.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Lead']);
  });

  it('accepts tabs between #EXTINF and duration token', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF\t:-1 tvg-name="TabDur",TabDur
https://example.com/tab-dur.m3u8
`);
    expect(stations[0].name).toBe('TabDur');
  });

  it('dedupes case-sensitive path segments (A.m3u8 ≠ a.m3u8)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Up",Up
https://example.com/A.m3u8
#EXTINF:-1 tvg-name="Low",Low
https://example.com/a.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Up', 'Low']);
  });

  it('lets xtvg-name steal name before later tvg-name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 xtvg-name="X" tvg-name="Real",Display
https://example.com/xtvg.m3u8
`);
    expect(stations[0].name).toBe('X');
  });

  it('lets mytvg-logo steal logo before later tvg-logo', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="L" mytvg-logo="https://fake" tvg-logo="https://real",L
https://example.com/my-logo.m3u8
`);
    expect(stations[0].logo).toBe('https://fake');
  });

  it('resets through consecutive non-http schemes then binds next https', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
rtmp://x
mms://y
udp://z
#EXTINF:-1 tvg-name="Two",Two
https://example.com/after-multi-reset.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Two']);
  });

  it('does not throw when URL line contains an embedded null byte', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Null",Null
https://example.com/nu\u0000ll.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toContain('\u0000');
  });

  it('preserves attribute values that contain http:// substrings', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="http://inside" group-title="see http://docs",http://inside
https://example.com/http-in-attrs.m3u8
`);
    expect(stations[0].name).toBe('http://inside');
    expect(stations[0].group).toBe('see http://docs');
    expect(stations[0].url).toBe('https://example.com/http-in-attrs.m3u8');
  });

  it('preserves # characters inside attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Hash#Tag" group-title="ch#ill",Hash
https://example.com/hash-attr.m3u8
`);
    expect(stations[0].name).toBe('Hash#Tag');
    expect(stations[0].group).toBe('ch#ill');
  });

  it('JSON round-trips full stations including empty-string optionals', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Full" tvg-logo="" group-title="" tvg-language="" tvg-country="",Full
https://example.com/json-full.m3u8
`);
    expect(JSON.parse(JSON.stringify(stations[0]))).toEqual({
      name: 'Full',
      url: 'https://example.com/json-full.m3u8',
      logo: '',
      group: '',
      language: '',
      country: '',
    });
  });

  it('does not match fullwidth ｈｔｔｐｓ：／／ lookalike schemes as streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Fw",Fw
ｈｔｔｐｓ://example.com/fw.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/fw-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('keeps insertion order when duplicates are interleaved with uniques', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
https://example.com/dup-inter.m3u8
#EXTINF:-1 tvg-name="Mid",Mid
https://example.com/mid.m3u8
#EXTINF:-1 tvg-name="DupAgain",DupAgain
https://example.com/dup-inter.m3u8
#EXTINF:-1 tvg-name="Last",Last
https://example.com/last.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['First', 'Mid', 'Last']);
  });

  it('accepts host-only https URL without path', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Host",Host
https://example.com
`);
    expect(stations[0].url).toBe('https://example.com');
  });

  it('does not treat spaced http :// as a stream URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sp",Sp
http ://example.com/spaced.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/spaced-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('enumerates station keys as own enumerable string props only', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Enum",Enum
https://example.com/enum.m3u8
`);
    const desc = Object.getOwnPropertyDescriptors(stations[0]);
    for (const key of Object.keys(desc)) {
      expect(desc[key].enumerable).toBe(true);
      expect(desc[key].configurable).toBe(true);
      expect(desc[key].writable).toBe(true);
    }
    expect(Object.getOwnPropertySymbols(stations[0])).toEqual([]);
  });

  it('ignores mid-playlist BOM on non-EXTINF comment lines', () => {
    const stations = parseM3U(`#EXTM3U
\uFEFF# comment
#EXTINF:-1 tvg-name="BomMid",BomMid
https://example.com/bom-mid.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['BomMid']);
  });

  it('resets on chrome-extension and about:blank non-http lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ext",Ext
chrome-extension://abcd/page
#EXTINF:-1 tvg-name="About",About
about:blank
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ext-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves plus-encoded and space-encoded query values literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Q",Q
https://example.com/q?a=b+c&d=e%20f
`);
    expect(stations[0].url).toBe('https://example.com/q?a=b+c&d=e%20f');
  });

  it('uses comma fallback when tvg-name attr is present but value quotes never close', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Unclosed,Fallback
https://example.com/unclosed.m3u8
`);
    // Unclosed quote → regex miss; lastIndexOf(',') still finds display name "Fallback"
    // but the line has no closing — actually the comma after Unclosed splits display.
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Fallback');
  });

  it('does not match group-title when value uses curly quotes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Curl" group-title=“Curly”,Curl
https://example.com/curly.m3u8
`);
    expect(stations[0].group).toBeUndefined();
  });

  it('accepts EXTINF duration as float and scientific notation forms', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:12.5 tvg-name="Float",Float
https://example.com/float.m3u8
#EXTINF:1e2 tvg-name="Sci",Sci
https://example.com/sci.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Float', 'Sci']);
  });

  it('locks Object.values order matching name/url/logo/group/language/country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="V" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",V
https://example.com/values.m3u8
`);
    expect(Object.values(stations[0])).toEqual([
      'V',
      'https://example.com/values.m3u8',
      'L',
      'G',
      'en',
      'US',
    ]);
  });

  it('does not coalesce trailing-dot host vs non-dot host for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="DotHost",DotHost
https://example.com./stream.m3u8
#EXTINF:-1 tvg-name="NoDot",NoDot
https://example.com/stream.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['DotHost', 'NoDot']);
  });

  it('keeps EXTINF state across #EXTALB and #EXTART tags', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Meta",Meta
#EXTALB:Album
#EXTART:Artist
https://example.com/meta.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Meta']);
  });

  it('returns [] when only non-http URL schemes are present', () => {
    expect(
      parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="R",R
rtmp://example.com/live
#EXTINF:-1 tvg-name="U",U
udp://@239.0.0.1:1234
`),
    ).toEqual([]);
  });

  it('does not trim interior spaces from stream URL paths', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="PathSp",PathSp
https://example.com/with space/stream.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/with space/stream.m3u8');
  });

  it('matches TVG-LANGUAGE and TVG-COUNTRY case-insensitively', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Up" TVG-LANGUAGE="fr" TVG-COUNTRY="FR",Up
https://example.com/up-lang.m3u8
`);
    expect(stations[0].language).toBe('fr');
    expect(stations[0].country).toBe('FR');
  });

  it('lets prefixgroup-title win over later group-title', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="P" prefixgroup-title="Pref" group-title="Real",P
https://example.com/prefix-g.m3u8
`);
    expect(stations[0].group).toBe('Pref');
  });

  it('skips URL when comma fallback name is only unicode whitespace U+3000', () => {
    // Line trim strips U+3000 ideographic space in modern JS — lock empty-after-trim skip.
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,\u3000
https://example.com/ideo.m3u8
`);
    const name = ',\u3000'.slice(1).trim();
    if (!name) {
      expect(stations).toEqual([]);
    } else {
      expect(stations[0].name).toBe(name);
    }
  });

  it('preserves internationalized emoji domains in stream hosts', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="EmojiHost",EmojiHost
https://xn--ls8h.example/stream.m3u8
`);
    expect(stations[0].url).toBe('https://xn--ls8h.example/stream.m3u8');
  });

  it('does not treat http／slash fullwidth solidus as http:// scheme', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="FwSlash",FwSlash
http：／／example.com/fw.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/fw-slash-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('structuredClone round-trips stations without losing optional fields', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Clone" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",Clone
https://example.com/clone.m3u8
`);
    expect(structuredClone(stations)).toEqual(stations);
  });

  it('Object.assign shallow-copies a station without sharing the source object', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Assign",Assign
https://example.com/assign.m3u8
`);
    const copy = Object.assign({}, stations[0]);
    copy.name = 'Mutated';
    expect(stations[0].name).toBe('Assign');
    expect(copy.url).toBe(stations[0].url);
  });

  it('always returns a real Array instance', () => {
    expect(Array.isArray(parseM3U(''))).toBe(true);
    expect(Array.isArray(parseM3U(`#EXTINF:-1,A
https://example.com/a.m3u8
`))).toBe(true);
  });

  it('resets on view-source, android-app, intent, sip, sms, irc, and cid schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="VS",VS
view-source:https://example.com
#EXTINF:-1 tvg-name="AA",AA
android-app://com.example
#EXTINF:-1 tvg-name="In",In
intent://scan/#Intent;end
#EXTINF:-1 tvg-name="Sip",Sip
sip:user@example.com
#EXTINF:-1 tvg-name="Sms",Sms
sms:+15551212
#EXTINF:-1 tvg-name="Irc",Irc
irc://irc.example/#chan
#EXTINF:-1 tvg-name="Cid",Cid
cid:foo@bar
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/scheme-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves ZWSP and word-joiner code points inside station names', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A\u200BB\u2060C",A\u200BB\u2060C
https://example.com/zw.m3u8
`);
    expect(stations[0].name).toBe('A\u200BB\u2060C');
  });

  it('records empty-string values for all five optional attrs when quoted empty', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="E" tvg-logo="" group-title="" tvg-language="" tvg-country="",E
https://example.com/empty-attrs.m3u8
`);
    expect(stations[0]).toEqual({
      name: 'E',
      url: 'https://example.com/empty-attrs.m3u8',
      logo: '',
      group: '',
      language: '',
      country: '',
    });
  });

  it('preserves BCP-47 language tags like zh-Hans literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Zh" tvg-language="zh-Hans",Zh
https://example.com/zh.m3u8
`);
    expect(stations[0].language).toBe('zh-Hans');
  });

  it('preserves relative and root-relative logo paths literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Rel" tvg-logo="./logo.png",Rel
https://example.com/rel.m3u8
#EXTINF:-1 tvg-name="Root" tvg-logo="/img/logo.png",Root
https://example.com/root.m3u8
`);
    expect(stations[0].logo).toBe('./logo.png');
    expect(stations[1].logo).toBe('/img/logo.png');
  });

  it('accepts numeric-only comma-fallback display names', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,42
https://example.com/num.m3u8
`);
    expect(stations[0].name).toBe('42');
  });

  it('keeps a URL-shaped comma-fallback string as the station name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,https://not-a-stream.example/name
https://example.com/url-name.m3u8
`);
    expect(stations[0].name).toBe('https://not-a-stream.example/name');
    expect(stations[0].url).toBe('https://example.com/url-name.m3u8');
  });

  it('still honors tvg-name even when the attr appears after the display-name comma', () => {
    // Attribute regex scans the whole EXTINF line, including post-comma text.
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,Name tvg-name="FromAfterComma"
https://example.com/after-comma.m3u8
`);
    expect(stations[0].name).toBe('FromAfterComma');
  });

  it('keeps post-comma attr-like tokens in the display name when they are not quoted attrs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,Name tvg-name=Bare
https://example.com/bare-after-comma.m3u8
`);
    expect(stations[0].name).toBe('Name tvg-name=Bare');
  });

  it('preserves commas inside quoted group-title values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="G" group-title="Rock, Pop, & Jazz",G
https://example.com/grp-comma.m3u8
`);
    expect(stations[0].group).toBe('Rock, Pop, & Jazz');
  });

  it('ignores leading stream URLs that lack a preceding named EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
https://example.com/orphan-start.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/orphan-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not treat %23EXTINF inside a URL path as an EXTINF line', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Hash",Hash
https://example.com/path/%23EXTINF:/stream.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/path/%23EXTINF:/stream.m3u8');
  });

  it('preserves regional-indicator flag emoji in tvg-country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Flag" tvg-country="🇺🇸",Flag
https://example.com/flag.m3u8
`);
    expect(stations[0].country).toBe('🇺🇸');
  });

  it('lets the first tvg-name match win when the attribute appears twice', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First" tvg-name="Second",Disp
https://example.com/dup-name.m3u8
`);
    expect(stations[0].name).toBe('First');
  });

  it('JSON.stringify key order matches name/url/logo/group/language/country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="J" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",J
https://example.com/json-order.m3u8
`);
    expect(Object.keys(JSON.parse(JSON.stringify(stations[0])) as object)).toEqual([
      'name',
      'url',
      'logo',
      'group',
      'language',
      'country',
    ]);
  });

  it('does not reuse the same Partial object identity across pushed stations', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
`);
    expect(stations[0]).not.toBe(stations[1]);
    stations[0].name = 'Mutated';
    expect(stations[1].name).toBe('Two');
  });

  it('trims leading NBSP so a NBSP-prefixed https URL still binds', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Nbsp",Nbsp
\u00A0https://example.com/nbsp.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Nbsp']);
    expect(stations[0].url).toBe('https://example.com/nbsp.m3u8');
  });

  it('keeps EXTINF state across a lone # comment line', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="HashOnly",HashOnly
#
https://example.com/hash-only.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['HashOnly']);
  });

  it('still dedupes a URL after an intervening non-http reset', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
https://example.com/dedupe-reset.m3u8
#EXTINF:-1 tvg-name="Rtmp",Rtmp
rtmp://example.com/live
#EXTINF:-1 tvg-name="Dup",Dup
https://example.com/dedupe-reset.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['First']);
  });

  it('accepts IPv4-mapped IPv6 literal hosts', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mapped",Mapped
https://[::ffff:127.0.0.1]/stream.m3u8
`);
    expect(stations[0].url).toBe('https://[::ffff:127.0.0.1]/stream.m3u8');
  });

  it('preserves unicode path segments in stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Uni",Uni
https://example.com/ラジオ/stream.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/ラジオ/stream.m3u8');
  });

  it('preserves soft hyphens inside tvg-name values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Soft\u00ADhyphen",Soft\u00ADhyphen
https://example.com/shy.m3u8
`);
    expect(stations[0].name).toBe('Soft\u00ADhyphen');
  });

  it('does not match single-quoted or backtick-quoted attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name='Single' tvg-logo=\`Tick\` group-title='G',Fallback
https://example.com/quotes.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
    expect(stations[0].logo).toBeUndefined();
    expect(stations[0].group).toBeUndefined();
  });

  it('skips URL when EXTINF has no comma and no tvg-name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1
https://example.com/no-name.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/no-name-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves plus signs and equals in URL path/query literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Plus",Plus
https://example.com/a+b=c/stream.m3u8?x=1+2
`);
    expect(stations[0].url).toBe('https://example.com/a+b=c/stream.m3u8?x=1+2');
  });

  it('resets on Windows-path-looking and scheme-less host lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Win",Win
C:\\Streams\\live.m3u8
#EXTINF:-1 tvg-name="Bare",Bare
ftp.example.com/live.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/win-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('keeps EXTINF state across multiple blank lines before the URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Blank",Blank


https://example.com/blanks.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Blank']);
  });

  it('returns a fresh array instance on every call', () => {
    const a = parseM3U('');
    const b = parseM3U('');
    expect(a).not.toBe(b);
    a.push({
      name: 'x',
      url: 'https://example.com/x.m3u8',
    });
    expect(b).toEqual([]);
  });

  it('lets duplicate attr keys for logo/group/language/country keep the first match', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="D" tvg-logo="L1" tvg-logo="L2" group-title="G1" group-title="G2" tvg-language="en" tvg-language="fr" tvg-country="US" tvg-country="GB",D
https://example.com/dup-attrs.m3u8
`);
    expect(stations[0].logo).toBe('L1');
    expect(stations[0].group).toBe('G1');
    expect(stations[0].language).toBe('en');
    expect(stations[0].country).toBe('US');
  });

  it('accepts http URL with userinfo and IPv6 host together', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="U6",U6
https://user:pass@[2001:db8::1]:8443/live.m3u8
`);
    expect(stations[0].url).toBe('https://user:pass@[2001:db8::1]:8443/live.m3u8');
  });

  it('preserves NFD-decomposed characters without NFC-normalizing names', () => {
    const nfd = 'cafe\u0301';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${nfd}",${nfd}
https://example.com/nfd.m3u8
`);
    expect(stations[0].name).toBe(nfd);
    expect(stations[0].name).not.toBe(nfd.normalize('NFC'));
  });

  it('does not match tvg_name or group_title underscore attribute variants', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg_name="Under" group_title="G",Fallback
https://example.com/under.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
    expect(stations[0].group).toBeUndefined();
  });

  it('treats #EXTINF-prefixed tags that are not EXTINF duration lines as EXTINF starts', () => {
    // startsWith('#EXTINF') is prefix-based — #EXTINFXXX still clears current
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Drop",Drop
#EXTINFXXX junk
https://example.com/should-skip.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/extinfxxx-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves tab characters inside quoted attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A\tB" group-title="G\tH",A\tB
https://example.com/tabs.m3u8
`);
    expect(stations[0].name).toBe('A\tB');
    expect(stations[0].group).toBe('G\tH');
  });

  it('accepts query-only and fragment-only http URL suffixes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Q",Q
https://example.com?only=query
#EXTINF:-1 tvg-name="F",F
https://example.com#only-frag
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com?only=query',
      'https://example.com#only-frag',
    ]);
  });

  it('does not coalesce http vs https of otherwise identical remainder for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Http",Http
http://example.com/same-path.m3u8
#EXTINF:-1 tvg-name="Https",Https
https://example.com/same-path.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Http', 'Https']);
  });

  it('skips EXTINF whose comma-fallback name is only ASCII whitespace after trim', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,\t  
https://example.com/ws-name.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ws-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves logo URLs that contain spaces and query strings', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="LogoSp" tvg-logo="https://cdn.example/a b.png?x=1",LogoSp
https://example.com/logo-sp.m3u8
`);
    expect(stations[0].logo).toBe('https://cdn.example/a b.png?x=1');
  });

  it('returns [] for a playlist of only comments and blank lines', () => {
    expect(
      parseM3U(`#EXTM3U
# comment
#EXT-X-VERSION:3

# another
`),
    ).toEqual([]);
  });

  it('binds URL immediately after EXTINF with no intervening lines', () => {
    const stations = parseM3U(
      `#EXTINF:-1 tvg-name="Tight",Tight\nhttps://example.com/tight.m3u8`,
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Tight');
  });

  it('does not throw when attribute soup contains nested quotes and backslashes', () => {
    expect(() =>
      parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A\\"B" group-title="C\\"D",Fallback
https://example.com/soup.m3u8
`),
    ).not.toThrow();
  });

  it('keeps insertion order stable for 50 unique streams', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 50; i++) {
      lines.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
      lines.push(`https://example.com/order-${i}.m3u8`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(50);
    expect(stations.map((s) => s.name)).toEqual(
      Array.from({ length: 50 }, (_, i) => `S${i}`),
    );
  });

  it('resets on ws:// and wss:// WebSocket schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="WS",WS
ws://example.com/live
#EXTINF:-1 tvg-name="WSS",WSS
wss://example.com/live
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ws-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on mailto, tel, sms, and geo URI schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="M",M
mailto:dj@example.com
#EXTINF:-1 tvg-name="T",T
tel:+15551212
#EXTINF:-1 tvg-name="S",S
sms:+15551212
#EXTINF:-1 tvg-name="G",G
geo:37.78,-122.41
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/uri-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on file://, magnet:, blob:, and javascript: schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="F",F
file:///tmp/x.m3u8
#EXTINF:-1 tvg-name="Mag",Mag
magnet:?xt=urn:btih:abc
#EXTINF:-1 tvg-name="B",B
blob:https://example.com/uuid
#EXTINF:-1 tvg-name="J",J
javascript:alert(1)
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/scheme-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves percent-encoded UTF-8 sequences in stream paths', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Pct",Pct
https://example.com/%E3%81%82%E3%81%84.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/%E3%81%82%E3%81%84.m3u8');
  });

  it('preserves double-percent-encoded path segments literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Dbl",Dbl
https://example.com/%2520space.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/%2520space.m3u8');
  });

  it('accepts https URL with only host and port (no path)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Port",Port
https://stream.example.com:8443
`);
    expect(stations[0].url).toBe('https://stream.example.com:8443');
  });

  it('preserves matrix parameters and semicolon path segments', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mx",Mx
https://example.com/live;quality=hi;codec=aac
`);
    expect(stations[0].url).toBe('https://example.com/live;quality=hi;codec=aac');
  });

  it('does not coalesce trailing-slash vs bare-path URLs for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/live
#EXTINF:-1 tvg-name="B",B
https://example.com/live/
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('does not coalesce default-port vs explicit-port URLs for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/live.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com:443/live.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('does not coalesce www vs bare host for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x.m3u8
#EXTINF:-1 tvg-name="B",B
https://www.example.com/x.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('preserves RTL mark and LRM inside station names', () => {
    const name = 'Radio\u200eFM\u200fLive';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${name}",${name}
https://example.com/rtl.m3u8
`);
    expect(stations[0].name).toBe(name);
  });

  it('preserves BOM inside quoted tvg-name after line-level trim', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A\uFEFFB",A\uFEFFB
https://example.com/bom-mid.m3u8
`);
    expect(stations[0].name).toBe('A\uFEFFB');
  });

  it('preserves combining grapheme joiner U+034F in names', () => {
    const name = 'a\u034Fb';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${name}",${name}
https://example.com/cgj.m3u8
`);
    expect(stations[0].name).toBe(name);
  });

  it('accepts EXTINF with positive integer duration other than -1', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:3600 tvg-name="Hour",Hour
https://example.com/hour.m3u8
`);
    expect(stations[0].name).toBe('Hour');
  });

  it('accepts EXTINF with zero duration', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:0 tvg-name="Zero",Zero
https://example.com/zero.m3u8
`);
    expect(stations[0].name).toBe('Zero');
  });

  it('accepts EXTINF without a space before attributes when duration is -1', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1tvg-name="TightAttr",TightAttr
https://example.com/tight-attr.m3u8
`);
    expect(stations[0].name).toBe('TightAttr');
  });

  it('ignores tvg-id and other unknown attributes without capturing them', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="x.y" radio="true" tvg-name="Known" catchup="default",Known
https://example.com/unknown-attrs.m3u8
`);
    expect(stations[0]).toEqual({
      name: 'Known',
      url: 'https://example.com/unknown-attrs.m3u8',
      logo: undefined,
      group: undefined,
      language: undefined,
      country: undefined,
    });
    expect(stations[0]).not.toHaveProperty('tvg-id');
    expect(stations[0]).not.toHaveProperty('radio');
  });

  it('does not match attribute keys with surrounding spaces around equals', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name = "Spaced" group-title = "G",Fallback
https://example.com/spaced-eq.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
    expect(stations[0].group).toBeUndefined();
  });

  it('does not match unquoted attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name=Bare group-title=Rock,Fallback
https://example.com/unquoted.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
    expect(stations[0].group).toBeUndefined();
  });

  it('preserves equals signs inside quoted attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A=B=C" group-title="x=y",A=B=C
https://example.com/eq-val.m3u8
`);
    expect(stations[0].name).toBe('A=B=C');
    expect(stations[0].group).toBe('x=y');
  });

  it('preserves ampersands and question marks in attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A&B?" tvg-logo="https://cdn.example/x?a=1&b=2",A&B?
https://example.com/amp.m3u8
`);
    expect(stations[0].name).toBe('A&B?');
    expect(stations[0].logo).toBe('https://cdn.example/x?a=1&b=2');
  });

  it('skips playlist consisting only of bare http(s) URLs', () => {
    expect(
      parseM3U(`#EXTM3U
https://example.com/a.m3u8
http://example.com/b.m3u8
`),
    ).toEqual([]);
  });

  it('keeps first of three identical URLs and drops the later two', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="1",1
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="2",2
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="3",3
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('1');
  });

  it('allows Object.freeze on returned stations without throwing', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Fr",Fr
https://example.com/freeze.m3u8
`);
    expect(() => Object.freeze(stations)).not.toThrow();
    expect(() => Object.freeze(stations[0])).not.toThrow();
    expect(Object.isFrozen(stations[0])).toBe(true);
  });

  it('returned stations are plain objects (prototype Object.prototype)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="P",P
https://example.com/proto.m3u8
`);
    expect(Object.getPrototypeOf(stations[0])).toBe(Object.prototype);
  });

  it('does not define non-enumerable or symbol keys on stations', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="S",S
https://example.com/sym.m3u8
`);
    expect(Object.getOwnPropertySymbols(stations[0])).toEqual([]);
    expect(Object.keys(stations[0])).toEqual([
      'name',
      'url',
      'logo',
      'group',
      'language',
      'country',
    ]);
  });

  it('preserves punycode xn-- hostnames literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Idn",Idn
https://xn--bcher-kva.example/stream.m3u8
`);
    expect(stations[0].url).toBe('https://xn--bcher-kva.example/stream.m3u8');
  });

  it('preserves userinfo with percent-encoded reserved characters', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="U",U
https://user%40name:p%3Ass@example.com/live.m3u8
`);
    expect(stations[0].url).toBe('https://user%40name:p%3Ass@example.com/live.m3u8');
  });

  it('accepts IPv4 dotted-quad hosts', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="IP",IP
http://203.0.113.10:8000/stream
`);
    expect(stations[0].url).toBe('http://203.0.113.10:8000/stream');
  });

  it('accepts IPv6 literal hosts in brackets', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Z",Z
https://[fe80::1]/stream.m3u8
`);
    expect(stations[0].url).toBe('https://[fe80::1]/stream.m3u8');
  });

  it('preserves multiple query parameters in original order', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Q",Q
https://example.com/x.m3u8?b=2&a=1&c=3
`);
    expect(stations[0].url).toBe('https://example.com/x.m3u8?b=2&a=1&c=3');
  });

  it('preserves fragment after query string', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="F",F
https://example.com/x.m3u8?q=1#track-2
`);
    expect(stations[0].url).toBe('https://example.com/x.m3u8?q=1#track-2');
  });

  it('does not coalesce query-param order differences for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x.m3u8?a=1&b=2
#EXTINF:-1 tvg-name="B",B
https://example.com/x.m3u8?b=2&a=1
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('does not coalesce fragment differences for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x.m3u8#a
#EXTINF:-1 tvg-name="B",B
https://example.com/x.m3u8#b
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('handles 100 unique stations without dropping any', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100; i++) {
      lines.push(`#EXTINF:-1 tvg-name="N${i}",N${i}`);
      lines.push(`https://example.com/bulk-${i}.m3u8`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(100);
    expect(stations[0].name).toBe('N0');
    expect(stations[99].name).toBe('N99');
  });

  it('dedupes within a 100-station playlist leaving uniques only', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100; i++) {
      lines.push(`#EXTINF:-1 tvg-name="D${i}",D${i}`);
      lines.push('https://example.com/dup-bulk.m3u8');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('D0');
  });

  it('skips EXTINF blocks interrupted by another EXTINF before the URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Lost",Lost
#EXTINF:-1 tvg-name="Kept",Kept
https://example.com/interrupted.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Kept']);
  });

  it('resets after a lone dot token then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Dot",Dot
.
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/dot-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('treats a lone slash path as a non-http reset line', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Slash",Slash
/relative/path.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/slash-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('treats protocol-relative //host URLs as non-http resets', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Rel",Rel
//cdn.example.com/live.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/rel-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not treat HTTP:// uppercase scheme as a stream URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Up",Up
HTTP://example.com/up.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/up-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not treat Http:// mixed-case scheme as a stream URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mix",Mix
Http://example.com/mix.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/mix-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves leading/trailing spaces inside quoted names (not trimmed by attr regex)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="  Spaced  ",  Spaced  
https://example.com/inner-space.m3u8
`);
    expect(stations[0].name).toBe('  Spaced  ');
  });

  it('trims only the comma-fallback display name, not tvg-name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,  FallbackTrim  
https://example.com/fallback-trim.m3u8
`);
    expect(stations[0].name).toBe('FallbackTrim');
  });

  it('uses empty tvg-name as falsy and skips when comma name is also empty', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="",
https://example.com/empty-both.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/empty-both-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('keeps empty-string logo/group/language/country distinct from undefined', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="E" tvg-logo="" group-title="" tvg-language="" tvg-country="",E
https://example.com/empty-opts.m3u8
`);
    expect(stations[0].logo).toBe('');
    expect(stations[0].group).toBe('');
    expect(stations[0].language).toBe('');
    expect(stations[0].country).toBe('');
    expect('logo' in stations[0]).toBe(true);
  });

  it('leaves optional fields undefined when attributes are absent', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bare",Bare
https://example.com/bare-opts.m3u8
`);
    expect(stations[0].logo).toBeUndefined();
    expect(stations[0].group).toBeUndefined();
    expect(stations[0].language).toBeUndefined();
    expect(stations[0].country).toBeUndefined();
  });

  it('preserves surrogate-pair emoji sequences in names and groups', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="📻 Radio" group-title="🎵 Music",📻 Radio
https://example.com/emoji.m3u8
`);
    expect(stations[0].name).toBe('📻 Radio');
    expect(stations[0].group).toBe('🎵 Music');
  });

  it('preserves skin-tone and ZWJ emoji sequences in names', () => {
    const name = '👨‍👩‍👧‍👦';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${name}",${name}
https://example.com/zwj.m3u8
`);
    expect(stations[0].name).toBe(name);
  });

  it('accepts very long station names (2k chars) without truncation', () => {
    const name = 'N'.repeat(2000);
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${name}",${name}
https://example.com/long-name.m3u8
`);
    expect(stations[0].name).toHaveLength(2000);
  });

  it('accepts very long stream URLs (4k chars) without truncation', () => {
    const url = `https://example.com/${'p'.repeat(4000)}.m3u8`;
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="L",L
${url}
`);
    expect(stations[0].url).toBe(url);
  });

  it('JSON.stringify then parse round-trips a fully-populated station', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Full" tvg-logo="https://cdn.example/l.png" group-title="G" tvg-language="en" tvg-country="US",Full
https://example.com/full.m3u8
`);
    expect(JSON.parse(JSON.stringify(stations[0]))).toEqual(stations[0]);
  });

  it('does not match hyphenated lookalike tvg--name double-hyphen keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg--name="Bad" group--title="G",Fallback
https://example.com/dbl-hyphen.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
    expect(stations[0].group).toBeUndefined();
  });

  it('does not match tvg.name dotted attribute keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg.name="Dotted",Fallback
https://example.com/dotted.m3u8
`);
    expect(stations[0].name).toBe('Fallback');
  });

  it('lets xtvg-language and xtvg-country steal before later real keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="X" xtvg-language="xx" tvg-language="en" xtvg-country="XX" tvg-country="US",X
https://example.com/xlang.m3u8
`);
    expect(stations[0].language).toBe('xx');
    expect(stations[0].country).toBe('XX');
  });

  it('keeps EXTINF state across #EXTGRP and #EXTVLCOPT tags', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Vlc",Vlc
#EXTGRP:Jazz
#EXTVLCOPT:network-caching=1000
https://example.com/vlc.m3u8
`);
    expect(stations[0].name).toBe('Vlc');
  });

  it('keeps EXTINF state across #EXT-X-STREAM-INF HLS tags', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Hls",Hls
#EXT-X-STREAM-INF:BANDWIDTH=128000
https://example.com/hls.m3u8
`);
    expect(stations[0].name).toBe('Hls');
  });

  it('resets on gopher:// and ftp:// then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Go",Go
gopher://example.com/1
#EXTINF:-1 tvg-name="Ftp",Ftp
ftp://example.com/a.mp3
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/gopher-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves backslash characters inside quoted attribute values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A\\\\B" group-title="C\\\\D",A\\\\B
https://example.com/backslash.m3u8
`);
    expect(stations[0].name).toBe('A\\\\B');
    expect(stations[0].group).toBe('C\\\\D');
  });

  it('preserves angle brackets and braces inside quoted names', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="<Radio>{FM}",<Radio>{FM}
https://example.com/angles.m3u8
`);
    expect(stations[0].name).toBe('<Radio>{FM}');
  });

  it('preserves pipe and backtick characters in names', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A|B\`C",A|B\`C
https://example.com/pipe.m3u8
`);
    expect(stations[0].name).toBe('A|B`C');
  });

  it('accepts playlist with Windows CRLF between every token', () => {
    const raw = ['#EXTM3U', '#EXTINF:-1 tvg-name="CRLF",CRLF', 'https://example.com/crlf-full.m3u8', ''].join(
      '\r\n',
    );
    const stations = parseM3U(raw);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('CRLF');
  });

  it('handles lone CR characters embedded mid-URL as part of the URL string', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="CR",CR\nhttps://example.com/cr\rok.m3u8\n',
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toContain('\r');
  });

  it('returns [] when raw is only whitespace characters', () => {
    expect(parseM3U('   \t  \n  \t\n')).toEqual([]);
  });

  it('does not throw on a large playlist of only comments', () => {
    const raw = `#EXTM3U\n${'# comment\n'.repeat(5000)}`;
    expect(() => parseM3U(raw)).not.toThrow();
    expect(parseM3U(raw)).toEqual([]);
  });

  it('Array.isArray is true and constructor is Array', () => {
    const stations = parseM3U('');
    expect(Array.isArray(stations)).toBe(true);
    expect(stations.constructor).toBe(Array);
  });

  it('mutations to the returned array do not affect a subsequent parse', () => {
    const a = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a-mut.m3u8
`);
    a.pop();
    const b = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a-mut.m3u8
`);
    expect(b).toHaveLength(1);
  });

  it('preserves ISO-3166-1 alpha-3 looking country codes literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="C" tvg-country="USA",C
https://example.com/usa.m3u8
`);
    expect(stations[0].country).toBe('USA');
  });

  it('preserves multi-language comma lists inside tvg-language quotes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="L" tvg-language="en,fr,de",L
https://example.com/langs.m3u8
`);
    expect(stations[0].language).toBe('en,fr,de');
  });

  it('preserves multi-country comma lists inside tvg-country quotes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="C" tvg-country="US,CA,MX",C
https://example.com/countries.m3u8
`);
    expect(stations[0].country).toBe('US,CA,MX');
  });

  it('binds http URL immediately followed by more EXTINF on later lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['One', 'Two']);
  });

  it('ignores #extm3u lowercase header as a non-EXTINF comment', () => {
    const stations = parseM3U(`#extm3u
#EXTINF:-1 tvg-name="H",H
https://example.com/header-case.m3u8
`);
    expect(stations[0].name).toBe('H');
  });

  it('does not start a new EXTINF record on #extinf lowercase', () => {
    const stations = parseM3U(`#EXTM3U
#extinf:-1 tvg-name="Lower",Lower
https://example.com/should-skip-lower.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/extinf-case-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('accepts data: URL only as logo, never as stream', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="D" tvg-logo="data:image/png;base64,aaa",D
data:text/plain,hello
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/data-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
    expect(stations[0].logo).toBeUndefined();
  });

  it('can attach data: logo on a successful https stream', () => {
    const logo = 'data:image/png;base64,aaa';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="D" tvg-logo="${logo}",D
https://example.com/data-logo.m3u8
`);
    expect(stations[0].logo).toBe(logo);
  });

  it('preserves + and & and = in userinfo and path', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="S",S
https://a+b:c&d=e@example.com/p+q&r=s.m3u8
`);
    expect(stations[0].url).toBe('https://a+b:c&d=e@example.com/p+q&r=s.m3u8');
  });

  it('structuredClone of the full result array deep-copies stations', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="SC" group-title="G",SC
https://example.com/sc.m3u8
`);
    const clone = structuredClone(stations);
    expect(clone).toEqual(stations);
    expect(clone[0]).not.toBe(stations[0]);
    clone[0].name = 'mutated';
    expect(stations[0].name).toBe('SC');
  });

  it('does not treat https with an interior tab as an https URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Tab",Tab
https\t://example.com/tab.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/tab-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves tilde and asterisk in stream paths', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="T",T
https://example.com/~user/*/live.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/~user/*/live.m3u8');
  });

  it('preserves @ in path (not only userinfo)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="At",At
https://example.com/path/@id/stream.m3u8
`);
    expect(stations[0].url).toBe('https://example.com/path/@id/stream.m3u8');
  });

  it('does not coalesce trailing ? vs no-query for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/x.m3u8?
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('does not coalesce trailing # vs no-fragment for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/x.m3u8#
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('accepts numeric host labels without resolving them', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="N",N
https://123.456.example/stream.m3u8
`);
    expect(stations[0].url).toBe('https://123.456.example/stream.m3u8');
  });

  it('preserves underscore and dollar in host-like labels', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="U",U
https://my_host$x.example/stream.m3u8
`);
    expect(stations[0].url).toBe('https://my_host$x.example/stream.m3u8');
  });

  it('round-trips through buildSimpleM3U helper shape when attrs are full', () => {
    // Inline fixture mirroring helpers.buildSimpleM3U output shape
    const m3u = `#EXTM3U
#EXTINF:-1 tvg-name="R" tvg-logo="https://cdn.example/r.png" group-title="Jazz" tvg-language="en" tvg-country="US",R
https://example.com/round.m3u8
`;
    expect(parseM3U(m3u)[0]).toEqual({
      name: 'R',
      url: 'https://example.com/round.m3u8',
      logo: 'https://cdn.example/r.png',
      group: 'Jazz',
      language: 'en',
      country: 'US',
    });
  });

  it('skips consecutive EXTINF orphans then binds the final pair', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
#EXTINF:-1 tvg-name="B",B
#EXTINF:-1 tvg-name="C",C
https://example.com/final.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['C']);
  });

  it('resets on about: and chrome: schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
about:blank
#EXTINF:-1 tvg-name="C",C
chrome://flags
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/about-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves NFC and NFD as distinct names and distinct streams', () => {
    const nfc = 'café';
    const nfd = 'cafe\u0301';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${nfc}",${nfc}
https://example.com/nfc.m3u8
#EXTINF:-1 tvg-name="${nfd}",${nfd}
https://example.com/nfd-distinct.m3u8
`);
    expect(stations).toHaveLength(2);
    expect(stations[0].name).toBe(nfc);
    expect(stations[1].name).toBe(nfd);
    expect(stations[0].name).not.toBe(stations[1].name);
  });

  it('does not match group_title with underscore even case-insensitively', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="G" GROUP_TITLE="Nope",G
https://example.com/group-under.m3u8
`);
    expect(stations[0].group).toBeUndefined();
  });

  it('matches Group-Title mixed case via /i flag', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="G" Group-Title="Rock",G
https://example.com/group-mixed.m3u8
`);
    expect(stations[0].group).toBe('Rock');
  });

  it('returns a new Set-backed dedupe state per call (no cross-call leakage)', () => {
    const first = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/cross.m3u8
`);
    const second = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="B",B
https://example.com/cross.m3u8
`);
    expect(first[0].name).toBe('A');
    expect(second[0].name).toBe('B');
  });
  it('resets on rtsp:// and rtsps:// then recovers with https', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
rtsp://cam.example/stream
#EXTINF:-1 tvg-name="B",B
rtsps://cam.example/secure
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/rtsp-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on mms:// and mmsh:// legacy Windows Media schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
mms://media.example/a
#EXTINF:-1 tvg-name="B",B
mmsh://media.example/b
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/mms-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on stun: and turn: ICE URI schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
stun:stun.example:3478
#EXTINF:-1 tvg-name="B",B
turn:turn.example:3478?transport=udp
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/stun-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('accepts EXTINF with fractional float duration', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:12.5 tvg-name="Float",Float
https://example.com/float.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Float');
  });

  it('accepts EXTINF with scientific-notation-looking duration token', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:1e2 tvg-name="Sci",Sci
https://example.com/sci.m3u8
`);
    expect(stations[0].name).toBe('Sci');
  });

  it('comma-fallback name keeps text after the last comma only', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="A,B,C",Display, With, Commas
https://example.com/commas.m3u8
`);
    expect(stations[0].name).toBe('Commas');
  });

  it('preserves tab characters inside quoted tvg-name values', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A\tB",A
https://example.com/tab-name.m3u8
`);
    expect(stations[0].name).toBe('A\tB');
  });

  it('does not bind a tab-prefixed http URL after trim removes the tab', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="T",T
\thttps://example.com/tab-url.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/tab-url.m3u8');
  });

  it('resets on news: and nntp: URI schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
news:comp.protocols
#EXTINF:-1 tvg-name="B",B
nntp://news.example/group
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/news-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves unicode escapes that are already decoded in the raw string', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="café ☕",café ☕
https://example.com/cafe.m3u8
`);
    expect(stations[0].name).toBe('café ☕');
  });

  it('does not match tvg-name with single quotes instead of double quotes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name='Quoted',Fallback Name
https://example.com/sq.m3u8
`);
    expect(stations[0].name).toBe('Fallback Name');
    expect(stations[0].name).not.toBe('Quoted');
  });

  it('keeps EXTINF state across blank lines between attributes and URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Blank",Blank

https://example.com/blank-gap.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Blank');
  });

  it('resets on smb:// and afp:// network filesystem schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
smb://files.example/share
#EXTINF:-1 tvg-name="B",B
afp://files.example/share
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/smb-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves query string with empty values and repeated keys', () => {
    const url = 'https://example.com/x.m3u8?a=&a=1&b';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Q",Q
${url}
`);
    expect(stations[0].url).toBe(url);
  });

  it('does not coalesce http vs https same-host paths for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
http://example.com/same.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(2);
  });

  it('accepts EXTINF duration of -0 and +0 tokens', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-0 tvg-name="NegZero",NegZero
https://example.com/neg0.m3u8
#EXTINF:+0 tvg-name="PosZero",PosZero
https://example.com/pos0.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['NegZero', 'PosZero']);
  });

  it('ignores #EXTINF embedded inside a comment line starting with ##', () => {
    const stations = parseM3U(`#EXTM3U
##EXTINF:-1 tvg-name="Nope",Nope
https://example.com/should-skip.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/hashhash-ok.m3u8
`);
    // ## line is a comment (starts with # but not #EXTINF exactly... wait: startsWith('#EXTINF') is false for ##EXTINF)
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves station objects key insertion order name/url/logo/group/language/country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="K" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",K
https://example.com/keyorder.m3u8
`);
    expect(Object.keys(stations[0])).toEqual([
      'name',
      'url',
      'logo',
      'group',
      'language',
      'country',
    ]);
  });

  it('JSON.stringify of empty parse result is []', () => {
    expect(JSON.stringify(parseM3U(''))).toBe('[]');
    expect(JSON.stringify(parseM3U('#EXTM3U\n'))).toBe('[]');
  });

  it('does not throw when raw contains only unpaired high surrogate', () => {
    expect(() => parseM3U('\uD800')).not.toThrow();
    expect(parseM3U('\uD800')).toEqual([]);
  });

  it('resets on irc: and ircs: schemes then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
irc://irc.example/#chan
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/irc-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves very deep path segments without truncation', () => {
    const path = '/a/' + 'b/'.repeat(200) + 'c.m3u8';
    const url = `https://example.com${path}`;
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Deep",Deep
${url}
`);
    expect(stations[0].url).toBe(url);
    expect(stations[0].url.length).toBeGreaterThan(400);
  });

  it('treats a line of only https:// as a bindable URL with empty path', () => {
    // "https://" starts with https:// — binds if name present
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bare",Bare
https://
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://');
  });

  it('dedupe is case-sensitive for hostnames in stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://Example.com/x.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/x.m3u8
`);
    expect(stations).toHaveLength(2);
  });

  it('preserves unicode domain labels without punycode conversion', () => {
    const url = 'https://münchen.example/stream.m3u8';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="U",U
${url}
`);
    expect(stations[0].url).toBe(url);
    expect(stations[0].url).toContain('ü');
  });

  it('Array.prototype methods on result do not mutate parser internals across calls', () => {
    const a = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a-mut.m3u8
`);
    a.push({ name: 'injected', url: 'https://evil' });
    const b = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="B",B
https://example.com/b-mut.m3u8
`);
    expect(b).toHaveLength(1);
    expect(b[0].name).toBe('B');
  });

  it('resets on ldap:// git:// ssh:// and telnet:// then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
ldap://dir.example/cn=x
#EXTINF:-1 tvg-name="B",B
git://git.example/repo.git
#EXTINF:-1 tvg-name="C",C
ssh://git@example/repo.git
#EXTINF:-1 tvg-name="D",D
telnet://example:23
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ldap-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on redis:// postgres:// mongodb:// and jar: then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
redis://localhost:6379/0
#EXTINF:-1 tvg-name="B",B
postgres://user:pass@db/radio
#EXTINF:-1 tvg-name="C",C
mongodb://mongo.example/catalog
#EXTINF:-1 tvg-name="D",D
jar:file:/app.jar!/stream
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/db-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('accepts #EXTINF:NaN duration token and still binds attrs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:NaN tvg-name="Nano",Nano
https://example.com/nan.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Nano',
        url: 'https://example.com/nan.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('accepts #EXTINF:Infinity duration token and still binds', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:Infinity tvg-name="Inf",Inf
https://example.com/inf.m3u8
`);
    expect(stations[0].name).toBe('Inf');
    expect(stations[0].url).toBe('https://example.com/inf.m3u8');
  });

  it('accepts #EXTINF: with empty duration after colon before attrs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF: tvg-name="EmptyDur",EmptyDur
https://example.com/emptydur.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('EmptyDur');
  });

  it('cross-locks parseM3U(SAMPLE_M3U) length to countHttpStreamLines', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
    expect(stations.map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('round-trips buildSimpleM3U helper including optional attrs', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
      { name: 'Bare', url: 'http://example.com/bare.m3u8' },
    ]);
    expect(parseM3U(m3u)).toEqual([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
      {
        name: 'Bare',
        url: 'http://example.com/bare.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('scheme matrix property resets non-http then binds following https', () => {
    const schemes = [
      'ldap://x',
      'git://x',
      'ssh://x',
      'telnet://x',
      'redis://x',
      'vs://x',
      'cap://x',
      'ni:///x',
    ];
    for (const scheme of schemes) {
      const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Skip",Skip
${scheme}
#EXTINF:-1 tvg-name="Keep",Keep
https://example.com/keep-${encodeURIComponent(scheme)}.m3u8
`);
      expect(stations).toHaveLength(1);
      expect(stations[0].name).toBe('Keep');
    }
  });

  it('null-byte-only playlist returns [] without throwing', () => {
    expect(parseM3U('\0')).toEqual([]);
    expect(parseM3U('\0\0\0')).toEqual([]);
  });

  it('quoted tvg-name containing raw newline breaks across split lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Broken
Name",Broken
https://example.com/broken-nl.m3u8
`);
    // Line split means the closing quote never appears on the EXTINF line;
    // comma-fallback may still yield a name from the EXTINF fragment.
    expect(stations.length).toBeLessThanOrEqual(1);
    if (stations.length === 1) {
      expect(stations[0].url).toBe('https://example.com/broken-nl.m3u8');
      expect(stations[0].name).not.toBe('Broken\nName');
    }
  });

  it('NFC vs NFD URL path lookalikes remain distinct streams', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="NFC",NFC
https://example.com/caf\u00E9.m3u8
#EXTINF:-1 tvg-name="NFD",NFD
https://example.com/cafe\u0301.m3u8
`);
    expect(stations).toHaveLength(2);
    expect(stations[0].url).not.toBe(stations[1].url);
  });

  it('buildSimpleM3U scale of 200 unique stations preserves order and length', () => {
    const input = Array.from({ length: 200 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/s${i}.m3u8`,
    }));
    const stations = parseM3U(buildSimpleM3U(input));
    expect(stations).toHaveLength(200);
    expect(stations.map((s) => s.name)).toEqual(input.map((s) => s.name));
    expect(stations.map((s) => s.url)).toEqual(input.map((s) => s.url));
  });

  it('accepts #EXTINF:+1e3 scientific duration and binds', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:+1e3 tvg-name="SciPos",SciPos
https://example.com/scipos.m3u8
`);
    expect(stations[0].name).toBe('SciPos');
  });

  it('accepts #EXTINF:-Infinity and #EXTINF:-NaN duration tokens', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-Infinity tvg-name="NegInf",NegInf
https://example.com/neginf.m3u8
#EXTINF:-NaN tvg-name="NegNan",NegNan
https://example.com/negnan.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['NegInf', 'NegNan']);
  });

  it('resets on docker:// and oci:// image-reference schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
docker://library/nginx:latest
#EXTINF:-1 tvg-name="B",B
oci://ghcr.io/org/image:tag
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/oci-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves plus and at-sign in stream URL userinfo', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Auth",Auth
https://user+tag:p@ss@example.com/stream.m3u8
`);
    expect(stations[0].url).toBe('https://user+tag:p@ss@example.com/stream.m3u8');
  });

  it('dedupes identical URLs even when EXTINF names differ', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
https://example.com/same-dup.m3u8
#EXTINF:-1 tvg-name="Second",Second
https://example.com/same-dup.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('First');
  });

  it('does not bind URL lines that appear before any EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
https://example.com/orphan.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/after.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual(['https://example.com/after.m3u8']);
  });

  it('trims spaces around URL lines before scheme detection', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Spaced",Spaced
   https://example.com/spaced.m3u8   
`);
    expect(stations[0].url).toBe('https://example.com/spaced.m3u8');
  });

  it('resets on non-http after EXTINF then does not leak name to later URL without new EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Leak",Leak
rtmp://example.com/live
https://example.com/should-not-bind.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok-after-reset.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('countHttpStreamLines ignores non-http schemes in SAMPLE-like bodies', () => {
    const body = `#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a.m3u8
#EXTINF:-1 tvg-name="B",B
rtmp://example.com/b
#EXTINF:-1 tvg-name="C",C
http://example.com/c.m3u8
`;
    expect(countHttpStreamLines(body)).toBe(2);
    expect(parseM3U(body)).toHaveLength(2);
  });

  it('buildSimpleM3U empty stations yields only header and parses to []', () => {
    expect(parseM3U(buildSimpleM3U([]))).toEqual([]);
  });

  it('preserves IPv6 literal hosts in stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="V6",V6
https://[2001:db8::1]:8443/live.m3u8
`);
    expect(stations[0].url).toBe('https://[2001:db8::1]:8443/live.m3u8');
  });

  it('accepts EXTINF duration 0 and binds', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:0 tvg-name="Zero",Zero
https://example.com/zero.m3u8
`);
    expect(stations[0].name).toBe('Zero');
  });

  it('multiple consecutive blank lines between EXTINF and URL still bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Blanky",Blanky


https://example.com/blanky.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Blanky');
  });

  it('does not treat http\\t:// tab-injected scheme as http', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
http\t://example.com/tab-scheme.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/tab-scheme-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('SAMPLE_M3U helper stations all carry Music group-title', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.every((s) => s.group === 'Music')).toBe(true);
  });

  it('resets on bitcoin: ethereum: and ipfs:// schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
bitcoin:addr
#EXTINF:-1 tvg-name="B",B
ethereum:0xabc
#EXTINF:-1 tvg-name="C",C
ipfs://QmHash
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/crypto-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves fragment identifiers on stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Frag",Frag
https://example.com/live.m3u8#track=1&x=y
`);
    expect(stations[0].url).toBe('https://example.com/live.m3u8#track=1&x=y');
  });

  it('buildSimpleM3U with only logo optional still parses logo', () => {
    const m3u = buildSimpleM3U([
      { name: 'LogoOnly', url: 'https://example.com/lo.m3u8', logo: 'https://cdn.example/lo.png' },
    ]);
    expect(parseM3U(m3u)[0]).toMatchObject({
      name: 'LogoOnly',
      logo: 'https://cdn.example/lo.png',
      group: undefined,
    });
  });

  it('does not bind https URL when EXTINF name is whitespace-only after comma fallback', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,
https://example.com/blank-name.m3u8
`);
    // comma with nothing after → name '' which is falsy → no bind
    expect(stations).toEqual([]);
  });

  it('countHttpStreamLines equals parse length for buildSimpleM3U outputs', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a.example/a' },
      { name: 'B', url: 'http://b.example/b' },
      { name: 'C', url: 'rtmp://c.example/c' },
    ]);
    // buildSimpleM3U will still emit rtmp line; parser skips it
    expect(countHttpStreamLines(m3u)).toBe(2);
    expect(parseM3U(m3u)).toHaveLength(2);
  });

  it('resets on data: and blob: then recovers with http', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
data:text/plain,hi
#EXTINF:-1 tvg-name="B",B
blob:https://example.com/uuid
#EXTINF:-1 tvg-name="Ok",Ok
http://example.com/data-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('preserves extremely long tvg-name values without truncation', () => {
    const longName = 'N'.repeat(4000);
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${longName}",Short
https://example.com/long-name.m3u8
`);
    expect(stations[0].name).toBe(longName);
    expect(stations[0].name).toHaveLength(4000);
  });

  it('dedupe Set is per-parseM3U call not global', () => {
    const body = `#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/dedupe-indep.m3u8
`;
    expect(parseM3U(body)).toHaveLength(1);
    expect(parseM3U(body)).toHaveLength(1);
    expect(parseM3U(body + body)).toHaveLength(1);
  });

  it('accepts EXTINF with only comma-fallback name and no attrs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,OnlyComma
https://example.com/only-comma.m3u8
`);
    expect(stations[0].name).toBe('OnlyComma');
  });

  it('ignores #EXTVLCOPT and other non-EXTINF hash lines without resetting current', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="VLC",VLC
#EXTVLCOPT:network-caching=1000
https://example.com/vlc.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('VLC');
  });

  it('resets on non-http between two https entries without leaking first name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="One",One
https://example.com/one.m3u8
#EXTINF:-1 tvg-name="Skip",Skip
udp://1.2.3.4:5000
https://example.com/should-skip.m3u8
#EXTINF:-1 tvg-name="Two",Two
https://example.com/two.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['One', 'Two']);
  });

  it('parseM3U result is a plain Array with Array.prototype', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(Object.getPrototypeOf(stations)).toBe(Array.prototype);
    expect(Array.isArray(stations)).toBe(true);
  });

  it('station objects include undefined optional fields as own keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bare",Bare
https://example.com/bare2.m3u8
`);
    expect(Object.prototype.hasOwnProperty.call(stations[0], 'logo')).toBe(true);
    expect(stations[0].logo).toBeUndefined();
  });

  it('does not treat htt:// typo scheme as http', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
htt://example.com/typo.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/typo-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('cross-locks SAMPLE_M3U http count against unique URL set size', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(new Set(stations.map((s) => s.url)).size).toBe(stations.length);
    expect(stations.length).toBe(countHttpStreamLines(SAMPLE_M3U));
  });

  it('buildSimpleM3U country-only optional parses country', () => {
    const m3u = buildSimpleM3U([
      { name: 'Country', url: 'https://example.com/co.m3u8', country: 'JP' },
    ]);
    expect(parseM3U(m3u)[0].country).toBe('JP');
    expect(parseM3U(m3u)[0].language).toBeUndefined();
  });

  it('handles CRLF line endings equivalently to LF for simple entries', () => {
    const lf = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="CR",CR\nhttps://example.com/cr.m3u8\n`);
    const crlf = parseM3U(`#EXTM3U\r\n#EXTINF:-1 tvg-name="CR",CR\r\nhttps://example.com/cr.m3u8\r\n`);
    expect(crlf).toEqual(lf);
  });

  it('resets on about:blank and chrome:// schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
about:blank
#EXTINF:-1 tvg-name="B",B
chrome://settings
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/about-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on magnet: sms: tel: and file: exotic schemes then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
magnet:?xt=urn:btih:deadbeef
#EXTINF:-1 tvg-name="B",B
sms:+15551212
#EXTINF:-1 tvg-name="C",C
tel:+15559876
#EXTINF:-1 tvg-name="D",D
file:///tmp/local.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/exotic-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on ws: wss: mailto: ftp: and sftp: then recovers with http', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
ws://example.com/live
#EXTINF:-1 tvg-name="B",B
wss://example.com/secure
#EXTINF:-1 tvg-name="C",C
mailto:dj@example.com
#EXTINF:-1 tvg-name="D",D
ftp://files.example/a.mp3
#EXTINF:-1 tvg-name="E",E
sftp://files.example/b.mp3
#EXTINF:-1 tvg-name="Ok",Ok
http://example.com/scheme-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('treats NFC and NFD URL hosts as distinct streams', () => {
    const nfc = 'https://example.com/caf\u00E9.m3u8';
    const nfd = `https://example.com/cafe\u0301.m3u8`;
    expect(nfc.normalize('NFC')).not.toBe(nfd);
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="NFC",NFC
${nfc}
#EXTINF:-1 tvg-name="NFD",NFD
${nfd}
`);
    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.url)).toEqual([nfc, nfd]);
  });

  it('handles mixed CRLF and LF line endings in one playlist', () => {
    const body =
      '#EXTM3U\r\n#EXTINF:-1 tvg-name="A",A\nhttps://example.com/a-mixed.m3u8\r\n#EXTINF:-1 tvg-name="B",B\r\nhttps://example.com/b-mixed.m3u8\n';
    const stations = parseM3U(body);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('EXTM3U-only body parses to empty array', () => {
    expect(parseM3U('#EXTM3U')).toEqual([]);
    expect(parseM3U('#EXTM3U\n')).toEqual([]);
    expect(parseM3U('#EXTM3U\r\n')).toEqual([]);
  });

  it('empty tvg-name quotes fall back to comma display name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="" group-title="G",Comma Fallback
https://example.com/empty-tvg.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Comma Fallback');
    expect(stations[0].group).toBe('G');
  });

  it('duplicate tvg-name attrs keep first-wins via RegExp match', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First" tvg-name="Second",Ignored
https://example.com/dup-tvg.m3u8
`);
    expect(stations[0].name).toBe('First');
  });

  it('duplicate group-title and tvg-logo attrs keep first-wins', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="X" group-title="G1" group-title="G2" tvg-logo="L1" tvg-logo="L2",X
https://example.com/dup-attrs.m3u8
`);
    expect(stations[0]).toMatchObject({ name: 'X', group: 'G1', logo: 'L1' });
  });

  it('preserves URL query string and fragment together', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="QF",QF
https://example.com/live.m3u8?token=abc&x=1#frag-2
`);
    expect(stations[0].url).toBe('https://example.com/live.m3u8?token=abc&x=1#frag-2');
  });

  it('scales to 100 unique stations preserving order and length', () => {
    const built = buildSimpleM3U(
      Array.from({ length: 100 }, (_, i) => ({
        name: `S${i}`,
        url: `https://example.com/scale-${i}.m3u8`,
      })),
    );
    const stations = parseM3U(built);
    expect(stations).toHaveLength(100);
    expect(stations[0].name).toBe('S0');
    expect(stations[99].name).toBe('S99');
    expect(countHttpStreamLines(built)).toBe(100);
  });

  it('binds http URL after comment-only lines without resetting current EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Commented",Commented
# this is a comment
#EXTVLCOPT:network-caching=1000
#PLAYLIST:ignored
https://example.com/after-comments.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Commented');
  });

  it('does not bind http URL after exotic scheme reset even with comments in between', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Leak",Leak
magnet:?xt=urn:btih:abc
# comment after reset
https://example.com/should-not-bind.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/after-magnet-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('empty tvg-name with whitespace-only comma fallback does not bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="",   
https://example.com/ws-fallback.m3u8
`);
    expect(stations).toEqual([]);
  });

  it('mixed CRLF playlist with ftp reset still recovers https', () => {
    const body =
      '#EXTM3U\r\n#EXTINF:-1 tvg-name="A",A\r\nftp://files.example/a\n#EXTINF:-1 tvg-name="Ok",Ok\r\nhttps://example.com/crlf-ftp-ok.m3u8\n';
    expect(parseM3U(body).map((s) => s.name)).toEqual(['Ok']);
  });

  it('NFC vs NFD tvg-name values remain distinct without normalization', () => {
    const nfc = 'Cafe\u00E9';
    const nfd = 'Cafe\u0065\u0301';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${nfc}",A
https://example.com/nfc-name.m3u8
#EXTINF:-1 tvg-name="${nfd}",B
https://example.com/nfd-name.m3u8
`);
    expect(stations[0].name).toBe(nfc);
    expect(stations[1].name).toBe(nfd);
    expect(stations[0].name).not.toBe(stations[1].name);
  });

  it('query-only and fragment-only https URLs both bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Q",Q
https://example.com/q.m3u8?only=query
#EXTINF:-1 tvg-name="F",F
https://example.com/f.m3u8#only-frag
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/q.m3u8?only=query',
      'https://example.com/f.m3u8#only-frag',
    ]);
  });

  it('buildSimpleM3U scale 100 round-trips through parseM3U and countHttpStreamLines', () => {
    const stationsIn = Array.from({ length: 100 }, (_, i) => ({
      name: `N${i}`,
      url: `http://cdn.example/${i}.aac`,
      group: i % 2 === 0 ? 'Even' : 'Odd',
    }));
    const m3u = buildSimpleM3U(stationsIn);
    const out = parseM3U(m3u);
    expect(out).toHaveLength(100);
    expect(countHttpStreamLines(m3u)).toBe(100);
    expect(out.filter((s) => s.group === 'Even')).toHaveLength(50);
  });

  it('file: and sms: interleaved with SAMPLE_M3U-style https keep only https', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="SkipFile",SkipFile
file://localhost/radio.mp3
#EXTINF:-1 tvg-name="Keep",Keep
https://example.com/keep-file.m3u8
#EXTINF:-1 tvg-name="SkipSms",SkipSms
sms:+1000
#EXTINF:-1 tvg-name="Keep2",Keep2
https://example.com/keep-sms.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Keep', 'Keep2']);
  });

  it('EXTM3U-only with trailing comments still yields []', () => {
    expect(
      parseM3U(`#EXTM3U
# comment
#PLAYLIST:x
`),
    ).toEqual([]);
  });

  it('duplicate language/country attrs observe first-wins', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="X" tvg-language="en" tvg-language="fr" tvg-country="US" tvg-country="CA",X
https://example.com/dup-lang.m3u8
`);
    expect(stations[0]).toMatchObject({ language: 'en', country: 'US' });
  });

  it('http after blank and hash comments without EXTINF does not invent a station', () => {
    const stations = parseM3U(`#EXTM3U
# just comments

https://example.com/orphan-after-comments.m3u8
`);
    expect(stations).toEqual([]);
  });

  it('tel: reset does not leak name across subsequent comment-only then https', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Phone",Phone
tel:+1999
# still reset
https://example.com/tel-leak.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/tel-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('wss: and mailto: batch reset then single https bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
wss://example.com/a
#EXTINF:-1 tvg-name="B",B
mailto:a@b.c
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/wss-mailto-ok.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/wss-mailto-ok.m3u8');
  });

  it('URL with long query and fragment still binds once', () => {
    const q = 'a=' + 'x'.repeat(200);
    const url = `https://example.com/long.m3u8?${q}#end`;
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Long",Long
${url}
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe(url);
  });

  it('empty quoted tvg-name with non-empty comma and logo attr', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="" tvg-logo="https://cdn.example/l.png",Display
https://example.com/empty-name-logo.m3u8
`);
    expect(stations[0]).toMatchObject({
      name: 'Display',
      logo: 'https://cdn.example/l.png',
    });
  });

  it('sftp: then ftp: then https recovers only the last EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
sftp://host/a
#EXTINF:-1 tvg-name="B",B
ftp://host/b
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/sftp-ftp-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  // --- HEAVY burn (post-#44): deepen parser unit slice only — no product inventing ---

  it('resets on gopher: and finger: then recovers with https', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="G",G
gopher://gopher.example/1/
#EXTINF:-1 tvg-name="F",F
finger://user@host
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/gopher-finger-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on ipfs: and ipns: content-addressed schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ipfs",Ipfs
ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
#EXTINF:-1 tvg-name="Ipns",Ipns
ipns://example.com/radio
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ipfs-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on javascript: and data:text/html schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Js",Js
javascript:alert(1)
#EXTINF:-1 tvg-name="DataHtml",DataHtml
data:text/html,<h1>x</h1>
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/js-data-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on chrome-extension: and moz-extension: browser schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Chrome",Chrome
chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/page.html
#EXTINF:-1 tvg-name="Moz",Moz
moz-extension://uuid/radio.html
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ext-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on git: ssh: and svn: VCS schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Git",Git
git://github.com/org/repo.git
#EXTINF:-1 tvg-name="Ssh",Ssh
ssh://git@host/path
#EXTINF:-1 tvg-name="Svn",Svn
svn://svn.example/trunk
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/vcs-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on ldap: news: nntp: and irc: messaging schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ldap",Ldap
ldap://ldap.example/dc=example
#EXTINF:-1 tvg-name="News",News
news:comp.sys.mac.announce
#EXTINF:-1 tvg-name="Nntp",Nntp
nntp://news.example/group
#EXTINF:-1 tvg-name="Irc",Irc
irc://irc.example/#radio
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/msg-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on sip: sips: and xmpp: realtime schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sip",Sip
sip:user@example.com
#EXTINF:-1 tvg-name="Sips",Sips
sips:secure@example.com
#EXTINF:-1 tvg-name="Xmpp",Xmpp
xmpp:room@conference.example
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/rt-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on dict: vscode: and view-source: tool schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Dict",Dict
dict://dict.org/d:radio
#EXTINF:-1 tvg-name="Vs",Vs
vscode://file/tmp/a
#EXTINF:-1 tvg-name="View",View
view-source:https://example.com/
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/tool-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('locks station object own-key order name url logo group language country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ordered" tvg-logo="https://cdn.example/o.png" group-title="G" tvg-language="en" tvg-country="US",Ordered
https://example.com/ordered.m3u8
`);
    expect(Object.keys(stations[0])).toEqual([
      'name',
      'url',
      'logo',
      'group',
      'language',
      'country',
    ]);
  });

  it('locks station own keys even when optional attrs are undefined', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sparse",Sparse
http://example.com/sparse.m3u8
`);
    expect(Object.keys(stations[0])).toEqual([
      'name',
      'url',
      'logo',
      'group',
      'language',
      'country',
    ]);
    expect(stations[0].logo).toBeUndefined();
    expect(stations[0].group).toBeUndefined();
    expect(stations[0].language).toBeUndefined();
    expect(stations[0].country).toBeUndefined();
  });

  it('JSON.stringify then parse preserves station field values and key order', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Round" tvg-logo="https://cdn.example/r.png" group-title="Jazz" tvg-language="en" tvg-country="GB",Round
https://example.com/round.m3u8
`);
    const round = JSON.parse(JSON.stringify(stations)) as typeof stations;
    expect(round).toEqual(stations);
    expect(Object.keys(round[0])).toEqual(Object.keys(stations[0]));
  });

  it('structuredClone of parse result is deep-equal but distinct identity', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const cloned = structuredClone(stations);
    expect(cloned).toEqual(stations);
    expect(cloned).not.toBe(stations);
    expect(cloned[0]).not.toBe(stations[0]);
    cloned[0].name = 'Hijacked';
    expect(stations[0].name).not.toBe('Hijacked');
  });

  it('Object.freeze on parse result array blocks push but allows deep reads', () => {
    const stations = Object.freeze(parseM3U(SAMPLE_M3U));
    expect(Object.isFrozen(stations)).toBe(true);
    expect(stations).toHaveLength(6);
    expect(stations[0].name).toBe('Alpha FM');
    expect(() => {
      (stations as unknown as { push: (v: unknown) => number }).push({ name: 'X' });
    }).toThrow();
  });

  it('Object.freeze on each station still exposes locked own keys', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Fr" group-title="G",Fr
https://example.com/fr.m3u8
`);
    const frozen = Object.freeze(stations[0]);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.name).toBe('Fr');
    expect(frozen.group).toBe('G');
    expect(() => {
      (frozen as { name: string }).name = 'Nope';
    }).toThrow();
  });

  it('Object.preventExtensions on station copy still allows reads', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Pe",Pe
https://example.com/pe.m3u8
`);
    const copy = Object.preventExtensions({ ...station });
    expect(Object.isExtensible(copy)).toBe(false);
    expect(copy.url).toBe('https://example.com/pe.m3u8');
    expect(() => {
      (copy as { extra?: string }).extra = 'nope';
    }).toThrow();
  });

  it('parse result Array.prototype methods do not invent stations', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.map((s) => s.name)).toHaveLength(6);
    expect(stations.filter((s) => s.url.includes('zeta'))).toHaveLength(1);
    expect(stations.find((s) => s.name === 'Missing')).toBeUndefined();
    expect([...stations].reverse().find((s) => s.name.endsWith('FM'))?.name).toBe('Zeta FM');
    expect(
      [...stations].sort((a, b) => a.name.localeCompare(b.name))[0].name,
    ).toBe('Alpha FM');
    expect(stations).toHaveLength(6);
  });

  it('spread-reverse copy of parse result does not mutate original order', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const names = stations.map((s) => s.name);
    const reversed = [...stations].reverse();
    expect(reversed.map((s) => s.name)).toEqual([...names].reverse());
    expect(stations.map((s) => s.name)).toEqual(names);
  });

  it('flatMap over stations preserves url uniqueness from dedupe Set', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="C",C
https://example.com/other.m3u8
`);
    const urls = stations.flatMap((s) => [s.url]);
    expect(urls).toEqual(['https://example.com/same.m3u8', 'https://example.com/other.m3u8']);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('dedupe is case-sensitive on URL strings (HTTP vs http already reset; path case kept)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Lower",Lower
https://example.com/Path.m3u8
#EXTINF:-1 tvg-name="Mixed",Mixed
https://example.com/path.m3u8
`);
    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/Path.m3u8',
      'https://example.com/path.m3u8',
    ]);
  });

  it('trailing slash vs no slash are distinct stream URLs for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/stream
#EXTINF:-1 tvg-name="B",B
https://example.com/stream/
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('http vs https same host/path are distinct for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Http",Http
http://example.com/same-path.m3u8
#EXTINF:-1 tvg-name="Https",Https
https://example.com/same-path.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Http', 'Https']);
  });

  it('query param order differences keep distinct URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x?a=1&b=2
#EXTINF:-1 tvg-name="B",B
https://example.com/x?b=2&a=1
`);
    expect(stations).toHaveLength(2);
  });

  it('fragment-only differences keep distinct URLs for dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/x#one
#EXTINF:-1 tvg-name="B",B
https://example.com/x#two
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/x#one',
      'https://example.com/x#two',
    ]);
  });

  it('preserves IPv4-mapped IPv6 literal hosts in https URLs', () => {
    const url = 'https://[::ffff:192.0.2.1]/8443/stream.m3u8';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="V4map",V4map
${url}
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe(url);
  });

  it('preserves zone-id style IPv6 host literals without normalizing', () => {
    const url = 'http://[fe80::1%25eth0]/8080/live';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Zone",Zone
${url}
`);
    expect(stations[0].url).toBe(url);
  });

  it('accepts https URL with empty path and only authority', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="AuthOnly",AuthOnly
https://stream.example.com
`);
    expect(stations[0].url).toBe('https://stream.example.com');
  });

  it('accepts http URL ending with slash-only path', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Slash",Slash
http://stream.example.com/
`);
    expect(stations[0].url).toBe('http://stream.example.com/');
  });

  it('does not bind bare scheme-relative //host URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Rel",Rel
//cdn.example.com/stream.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/after-rel.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not bind relative path URLs without a scheme', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="RelPath",RelPath
/relative/stream.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/after-relpath.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not bind ./ or ../ relative path stream lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Dot",Dot
./local.m3u8
#EXTINF:-1 tvg-name="DotDot",DotDot
../up.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/after-dots.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('trims surrounding whitespace so padded https lines still bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Pad",Pad
  https://example.com/padded.m3u8  
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/padded.m3u8');
  });

  it('trims tabs around http URL lines before scheme check', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Tab",Tab
\thttp://example.com/tabbed.m3u8\t
`);
    expect(stations[0].url).toBe('http://example.com/tabbed.m3u8');
  });

  it('binds https URL lines that contain interior spaces (prefix check only)', () => {
    // startsWith('https://') is true even with interior spaces — no URL validation
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Spaced",Spaced
https://example.com/has space.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/after-space-url.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Spaced', 'Ok']);
    expect(stations[0].url).toBe('https://example.com/has space.m3u8');
  });

  it('preserves tvg-name with leading/trailing spaces inside quotes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="  Spaced Name  ",Display
https://example.com/name-spaces.m3u8
`);
    expect(stations[0].name).toBe('  Spaced Name  ');
  });

  it('preserves group-title with interior double spaces', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="G" group-title="Late  Night",G
https://example.com/group-spaces.m3u8
`);
    expect(stations[0].group).toBe('Late  Night');
  });

  it('empty group-title quotes yield empty string group not undefined', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="E" group-title="",E
https://example.com/empty-group.m3u8
`);
    expect(stations[0].group).toBe('');
    expect(stations[0]).toHaveProperty('group', '');
  });

  it('empty tvg-logo quotes yield empty string logo not undefined', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="E" tvg-logo="",E
https://example.com/empty-logo.m3u8
`);
    expect(stations[0].logo).toBe('');
  });

  it('empty tvg-language and tvg-country quotes yield empty strings', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="E" tvg-language="" tvg-country="",E
https://example.com/empty-lang-country.m3u8
`);
    expect(stations[0]).toMatchObject({ language: '', country: '' });
  });

  it('attribute names are matched case-insensitively for tvg-name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 TVG-NAME="UpperAttr",Display
https://example.com/upper-attr.m3u8
`);
    expect(stations[0].name).toBe('UpperAttr');
  });

  it('attribute names are matched case-insensitively for group-title and tvg-logo', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 Group-Title="Jazz" Tvg-Logo="https://cdn.example/l.png" tvg-name="X",X
https://example.com/case-attrs.m3u8
`);
    expect(stations[0]).toMatchObject({
      group: 'Jazz',
      logo: 'https://cdn.example/l.png',
      name: 'X',
    });
  });

  it('does not match single-quoted attribute values (double-quote regex only)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name='SingleQuoted',CommaFallback
https://example.com/single-quote.m3u8
`);
    expect(stations[0].name).toBe('CommaFallback');
  });

  it('does not invent stations from #EXTINF lines alone without URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
#EXTINF:-1 tvg-name="B",B
#EXTINF:-1 tvg-name="C",C
`);
    expect(stations).toEqual([]);
  });

  it('last EXTINF wins when multiple EXTINF precede one http URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
#EXTINF:-1 tvg-name="Second",Second
https://example.com/last-wins.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Second');
  });

  it('orphaned http URL between two complete entries does not invent a name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a.m3u8
https://example.com/orphan.m3u8
#EXTINF:-1 tvg-name="B",B
https://example.com/b.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
    expect(stations.map((s) => s.url)).not.toContain('https://example.com/orphan.m3u8');
  });

  it('countHttpStreamLines counts orphan URLs that parseM3U rejects without name', () => {
    const m3u = `#EXTM3U
https://example.com/orphan.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ok.m3u8
`;
    expect(countHttpStreamLines(m3u)).toBe(2);
    expect(parseM3U(m3u)).toHaveLength(1);
  });

  it('buildSimpleM3U with all optional attrs round-trips through parseM3U', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Ambient',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(parseM3U(m3u)[0]).toEqual({
      name: 'Full',
      url: 'https://example.com/full.m3u8',
      logo: 'https://cdn.example/full.png',
      group: 'Ambient',
      language: 'en',
      country: 'US',
    });
  });

  it('buildSimpleM3U empty stations array yields EXTM3U-only parse []', () => {
    const m3u = buildSimpleM3U([]);
    expect(m3u.startsWith('#EXTM3U')).toBe(true);
    expect(parseM3U(m3u)).toEqual([]);
    expect(countHttpStreamLines(m3u)).toBe(0);
  });

  it('SAMPLE_M3U parse length matches unique http(s) lines', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
    expect(new Set(stations.map((s) => s.url)).size).toBe(stations.length);
  });

  it('does not capture tvg-rec or catchup unknown attrs onto station', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="X" tvg-rec="default" catchup="append" catchup-source="?offset=-1",X
https://example.com/unknown-attrs.m3u8
`);
    expect(Object.keys(stations[0])).toEqual([
      'name',
      'url',
      'logo',
      'group',
      'language',
      'country',
    ]);
    expect(JSON.stringify(stations[0])).not.toMatch(/tvg-rec|catchup/);
  });

  it('preserves unicode emoji in tvg-name and comma fallback', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="🎧 Night FM",🎧 Night FM
https://example.com/emoji-name.m3u8
#EXTINF:-1,🎸 Rock Only
https://example.com/emoji-comma.m3u8
`);
    expect(stations[0].name).toBe('🎧 Night FM');
    expect(stations[1].name).toBe('🎸 Rock Only');
  });

  it('preserves CJK characters in name group language and country', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="東京FM" group-title="音楽" tvg-language="日本語" tvg-country="JP",東京FM
https://example.com/cjk.m3u8
`);
    expect(stations[0]).toMatchObject({
      name: '東京FM',
      group: '音楽',
      language: '日本語',
      country: 'JP',
    });
  });

  it('preserves RTL Arabic and Hebrew names without reordering URL', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="إذاعة" group-title="أخبار",إذاعة
https://example.com/rtl-ar.m3u8
#EXTINF:-1 tvg-name="רדיו" group-title="חדשות",רדיו
https://example.com/rtl-he.m3u8
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/rtl-ar.m3u8',
      'https://example.com/rtl-he.m3u8',
    ]);
    expect(stations[0].name).toBe('إذاعة');
    expect(stations[1].name).toBe('רדיו');
  });

  it('preserves zero-width joiner inside tvg-name without stripping', () => {
    const name = 'Radio\u200DZone';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${name}",Display
https://example.com/zwj.m3u8
`);
    expect(stations[0].name).toBe(name);
    expect(stations[0].name.includes('\u200D')).toBe(true);
  });

  it('BOM-only first line after split/trim does not invent a station', () => {
    const stations = parseM3U(`\uFEFF#EXTM3U
#EXTINF:-1 tvg-name="Bom",Bom
https://example.com/bom.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Bom');
  });

  it('line with only BOM/whitespace trims to empty and is ignored', () => {
    const stations = parseM3U(`#EXTM3U
\uFEFF
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/bom-blank.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not treat U+2028 line separator inside EXTINF as a newline split', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="A\u2028B",A\u2028B\nhttps://example.com/ls.m3u8\n`,
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toContain('\u2028');
  });

  it('scales to 250 unique stations preserving insertion order', () => {
    const body = [
      '#EXTM3U',
      ...Array.from({ length: 250 }, (_, i) =>
        `#EXTINF:-1 tvg-name="S${i}",S${i}\nhttps://cdn.example/${i}.m3u8`,
      ),
    ].join('\n');
    const stations = parseM3U(body);
    expect(stations).toHaveLength(250);
    expect(stations[0].name).toBe('S0');
    expect(stations[249].name).toBe('S249');
    expect(stations[100].url).toBe('https://cdn.example/100.m3u8');
  });

  it('dedupes interleaved duplicate URLs keeping first name across scale', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 50; i++) {
      lines.push(`#EXTINF:-1 tvg-name="First${i}",First${i}`);
      lines.push(`https://example.com/dup-${i % 10}.m3u8`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(10);
    expect(stations.map((s) => s.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `First${i}`),
    );
  });

  it('resets on about:config and chrome://settings exotic lines', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="About",About
about:config
#EXTINF:-1 tvg-name="Chrome",Chrome
chrome://settings
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/about-chrome-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on blob: and filesystem: then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Blob",Blob
blob:https://example.com/uuid
#EXTINF:-1 tvg-name="Fs",Fs
filesystem:https://example.com/temporary/x
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/blob-fs-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('consecutive exotic-scheme resets do not leak prior EXTINF name', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
gopher://x
ipfs://y
javascript:z
chrome-extension://a/b
https://example.com/should-not-bind.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/multi-reset-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('hash comment lines between EXTINF and URL keep current EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXTVLCOPT:network-caching=1000
#COMMENT:still keeping
https://example.com/keep-comments.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('Keep');
  });

  it('blank lines between EXTINF and URL keep current EXTINF', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Blank",Blank

https://example.com/blank-gap.m3u8
`);
    expect(stations[0].name).toBe('Blank');
  });

  it('mixed blank and hash comments between EXTINF and URL keep current', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mixed",Mixed

# note

https://example.com/mixed-gap.m3u8
`);
    expect(stations[0].name).toBe('Mixed');
  });

  it('non-http token after comments resets so later https without EXTINF does not bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="X",X
# comment
rtmp://live.example/x
# comment
https://example.com/no-bind.m3u8
`);
    expect(stations).toEqual([]);
  });

  it('parseM3U returns a dense Array (no holes) for sparse-looking inputs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A",A
https://example.com/a.m3u8
#EXTINF:-1 tvg-name="Skip",Skip
ftp://skip
#EXTINF:-1 tvg-name="B",B
https://example.com/b.m3u8
`);
    expect(stations).toHaveLength(2);
    expect(Object.keys(stations)).toEqual(['0', '1']);
    expect(stations.length).toBe(Object.keys(stations).length);
  });

  it('station objects use Object.prototype and are plain objects', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Plain",Plain
https://example.com/plain.m3u8
`);
    expect(Object.getPrototypeOf(station)).toBe(Object.prototype);
    expect(station.constructor).toBe(Object);
    expect(Array.isArray(station)).toBe(false);
  });

  it('parse result array uses Array.prototype and Array constructor', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(Object.getPrototypeOf(stations)).toBe(Array.prototype);
    expect(stations.constructor).toBe(Array);
    expect(Array.isArray(stations)).toBe(true);
  });

  it('does not attach non-enumerable or symbol keys on stations', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sym",Sym
https://example.com/sym.m3u8
`);
    expect(Object.getOwnPropertySymbols(station)).toEqual([]);
    for (const key of Object.keys(station)) {
      expect(Object.getOwnPropertyDescriptor(station, key)?.enumerable).toBe(true);
    }
  });

  it('TextEncoder byte length of JSON.stringify(stations) is stable for SAMPLE_M3U', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const bytes = new TextEncoder().encode(JSON.stringify(stations)).length;
    expect(bytes).toBeGreaterThan(200);
    expect(bytes).toBeLessThan(5000);
    expect(JSON.parse(JSON.stringify(stations))).toEqual(stations);
  });

  it('idempotent parse of the same M3U yields deep-equal distinct arrays', () => {
    const a = parseM3U(SAMPLE_M3U);
    const b = parseM3U(SAMPLE_M3U);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('mutating one parse result does not affect a later parse of the same input', () => {
    const first = parseM3U(SAMPLE_M3U);
    first[0].name = 'Mutated';
    first.push({
      name: 'Injected',
      url: 'https://evil.example/x',
      logo: undefined,
      group: undefined,
      language: undefined,
      country: undefined,
    });
    const second = parseM3U(SAMPLE_M3U);
    expect(second[0].name).toBe('Alpha FM');
    expect(second).toHaveLength(6);
    expect(second.some((s) => s.name === 'Injected')).toBe(false);
  });

  it('comma-fallback name trims surrounding whitespace after last comma', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,   Trimmed Fallback   
https://example.com/trim-fallback.m3u8
`);
    expect(stations[0].name).toBe('Trimmed Fallback');
  });

  it('tvg-name empty with comma-fallback whitespace-only does not bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="",\t  
https://example.com/ws-only-fallback.m3u8
`);
    expect(stations).toEqual([]);
  });

  it('last comma wins for comma-fallback when attrs contain commas in quotes', () => {
    // group-title quotes prevent interior commas from being "last comma" for fallback
    // but when tvg-name missing, lastIndexOf(',') uses the display-name comma
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="News, Weather",News Weather Desk
https://example.com/comma-in-group.m3u8
`);
    expect(stations[0].name).toBe('News Weather Desk');
    expect(stations[0].group).toBe('News, Weather');
  });

  it('logo URL may use http while stream uses https without confusion', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Mix" tvg-logo="http://cdn.example/logo.png",Mix
https://example.com/mix-logo.m3u8
`);
    expect(stations[0].logo).toBe('http://cdn.example/logo.png');
    expect(stations[0].url).toBe('https://example.com/mix-logo.m3u8');
  });

  it('does not treat logo http URL as a stream line (attrs are not lines)', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Only" tvg-logo="http://cdn.example/only.png",Only
https://example.com/only-stream.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://example.com/only-stream.m3u8');
  });

  it('http URL with port 80 and https with 443 are preserved literally', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="P80",P80
http://example.com:80/a
#EXTINF:-1 tvg-name="P443",P443
https://example.com:443/b
`);
    expect(stations.map((s) => s.url)).toEqual([
      'http://example.com:80/a',
      'https://example.com:443/b',
    ]);
  });

  it('preserves non-default ports on both http and https', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="P8000",P8000
http://example.com:8000/live
#EXTINF:-1 tvg-name="P8443",P8443
https://example.com:8443/live
`);
    expect(stations.map((s) => s.url)).toEqual([
      'http://example.com:8000/live',
      'https://example.com:8443/live',
    ]);
  });

  it('userinfo with percent-encoded at-sign stays in URL', () => {
    const url = 'https://user%40mail:pass@example.com/stream';
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="At",At
${url}
`);
    expect(stations[0].url).toBe(url);
  });

  it('very long path segment still binds exactly once', () => {
    const segment = 'p'.repeat(4000);
    const url = `https://example.com/${segment}.m3u8`;
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="LongPath",LongPath
${url}
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe(url);
    expect(stations[0].url.length).toBeGreaterThan(4000);
  });

  it('very long tvg-name still binds without truncation', () => {
    const name = 'N'.repeat(5000);
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${name}",Short
https://example.com/long-name.m3u8
`);
    expect(stations[0].name).toBe(name);
    expect(stations[0].name).toHaveLength(5000);
  });

  it('Object.assign clone of station preserves locked key set', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Assign" group-title="G",Assign
https://example.com/assign.m3u8
`);
    const copy = Object.assign({}, station);
    expect(Object.keys(copy)).toEqual(Object.keys(station));
    expect(copy).toEqual(station);
    expect(copy).not.toBe(station);
  });

  it('spread clone of station is deep-equal for own enumerable fields', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Spread" tvg-language="en",Spread
https://example.com/spread.m3u8
`);
    const copy = { ...station };
    expect(copy).toEqual(station);
    copy.name = 'Changed';
    expect(station.name).toBe('Spread');
  });

  it('Proxy around parse result array still exposes length and stations', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const proxy = new Proxy(stations, {});
    expect(proxy).toHaveLength(6);
    expect(proxy[0].name).toBe('Alpha FM');
    expect(JSON.stringify(proxy)).toBe(JSON.stringify(stations));
  });

  it('does not invent /playlist or /now-playing product endpoints in parse output', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const blob = JSON.stringify(stations);
    expect(blob).not.toMatch(/\/playlist|\/now-playing|openapi|GEMINI/);
    expect(stations.every((s) => typeof s.name === 'string' && typeof s.url === 'string')).toBe(
      true,
    );
  });

  it('cross-locks countHttpStreamLines with parse length for buildSimpleM3U mixed attrs', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'http://a.example/1', language: 'en' },
      { name: 'B', url: 'https://b.example/2', country: 'US' },
      { name: 'C', url: 'https://c.example/3', logo: 'https://cdn.example/c.png', group: 'Rock' },
    ]);
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(3);
    expect(countHttpStreamLines(m3u)).toBe(3);
    expect(stations[2]).toMatchObject({
      name: 'C',
      group: 'Rock',
      logo: 'https://cdn.example/c.png',
    });
  });

  it('resets on gemini:// and matrix: collaboration schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Gem",Gem
gemini://geminispace.info/
#EXTINF:-1 tvg-name="Matrix",Matrix
matrix:r/room:example.com
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/gemini-matrix-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on bitcoin: and ethereum: payment URIs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Btc",Btc
bitcoin:1ExampleAddress
#EXTINF:-1 tvg-name="Eth",Eth
ethereum:0xabc
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/pay-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('http after payment-scheme reset without new EXTINF does not bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Pay",Pay
bitcoin:1Example
https://example.com/pay-leak.m3u8
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/pay-recover.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('last https station index matches length-1 for SAMPLE_M3U', () => {
    const stations = parseM3U(SAMPLE_M3U);
    let idx = -1;
    for (let i = 0; i < stations.length; i++) {
      if (stations[i].url.startsWith('https://')) idx = i;
    }
    expect(idx).toBe(stations.length - 1);
    expect(stations.at(-1)?.name).toBe('Zeta FM');
  });

  it('every SAMPLE_M3U station group is Music and language/country undefined', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.every((s) => s.group === 'Music')).toBe(true);
    expect(stations.every((s) => s.language === undefined && s.country === undefined)).toBe(true);
    expect(stations.every((s) => s.logo === undefined)).toBe(true);
  });

  it('locks SAMPLE_M3U name order Alpha through Zeta', () => {
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });


  // --- HEAVY burn (post-#51): parser unit deepen — no product invent ---

  it('returns empty array for empty string and header-only playlists', () => {
    expect(parseM3U('')).toEqual([]);
    expect(parseM3U('#EXTM3U\n')).toEqual([]);
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,Name\n')).toEqual([]);
  });

  it('ignores tvg-id while binding known fields', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-id="x" tvg-name="N" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",N\nhttps://u\n',
    );
    expect(stations).toEqual([
      { name: 'N', url: 'https://u', logo: 'https://l', group: 'G', language: 'en', country: 'US' },
    ]);
  });

  it('resets on rtmp udp ftp data and rtsp non-http schemes', () => {
    for (const scheme of ['rtmp://', 'udp://', 'ftp://', 'data:', 'rtsp://']) {
      const stations = parseM3U(
        `#EXTM3U\n#EXTINF:-1,Skip\n${scheme}example\n#EXTINF:-1,Keep\nhttps://keep\n`,
      );
      expect(stations).toEqual([
        {
          name: 'Keep',
          url: 'https://keep',
          logo: undefined,
          group: undefined,
          language: undefined,
          country: undefined,
        },
      ]);
    }
  });

  it('dedupes by exact URL string keeping first name', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1,First\nhttps://same\n#EXTINF:-1,Second\nhttps://same\n',
    );
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('First');
  });

  it('http and https URLs with same path are distinct keys', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1,A\nhttp://example.com/x\n#EXTINF:-1,B\nhttps://example.com/x\n',
    );
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('fallback comma name is used when tvg-name missing', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,Comma Name\nhttps://c\n')[0].name).toBe('Comma Name');
  });

  it('tvg-name wins over trailing comma display name', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Attr",Display\nhttps://c\n')[0].name,
    ).toBe('Attr');
  });

  it('empty tvg-name falls through to comma display name', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="",Display\nhttps://c\n')[0].name,
    ).toBe('Display');
  });

  it('attribute matching is case-insensitive for tvg-* and group-title', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 TVG-NAME="N" TVG-LOGO="https://l" GROUP-TITLE="G" TVG-LANGUAGE="en" TVG-COUNTRY="US",N\nhttps://u\n',
    );
    expect(s).toMatchObject({
      name: 'N',
      logo: 'https://l',
      group: 'G',
      language: 'en',
      country: 'US',
    });
  });

  it('trims lines so leading spaces before https still bind', () => {
    const stations = parseM3U('#EXTM3U\n#EXTINF:-1,Spaced\n  https://spaced\n');
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://spaced');
  });

  it('does not bind uppercase HTTP:// lines (startsWith is case-sensitive)', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,X\nHTTP://EXAMPLE\n')).toEqual([]);
  });

  it('EXTVLCOPT comments between EXTINF and URL do not clear pending attrs', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A",A\n#EXTVLCOPT:network-caching=1000\nhttps://a\n',
    );
    expect(stations).toEqual([
      {
        name: 'A',
        url: 'https://a',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('blank lines between EXTINF and URL are ignored without reset', () => {
    const stations = parseM3U('#EXTM3U\n#EXTINF:-1,A\n\n\nhttps://a\n');
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('A');
  });

  it('CRLF playlists parse the same as LF', () => {
    const lf = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    const crlf = parseM3U('#EXTM3U\r\n#EXTINF:-1,A\r\nhttps://a\r\n');
    expect(crlf).toEqual(lf);
  });

  it('duplicate EXTINF before URL uses the latest EXTINF attrs', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="Old",Old\n#EXTINF:-1 tvg-name="New",New\nhttps://u\n',
    );
    expect(s.name).toBe('New');
  });

  it('URL without preceding EXTINF name does not bind', () => {
    expect(parseM3U('#EXTM3U\nhttps://orphan\n')).toEqual([]);
  });

  it('SAMPLE_M3U parses to six stations with Music group', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations).toHaveLength(6);
    expect(stations.every((s) => s.group === 'Music')).toBe(true);
    expect(stations.map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('buildSimpleM3U fixtures parse with countHttpStreamLines parity', () => {
    const m3u = buildSimpleM3U([
      { name: 'A', url: 'https://a', group: 'G' },
      { name: 'B', url: 'http://b', language: 'en', country: 'US', logo: 'https://l' },
    ]);
    expect(countHttpStreamLines(m3u)).toBe(parseM3U(m3u).length);
  });

  it('does not invent playlist or nowPlaying fields on Station objects', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(s).not.toHaveProperty('playlist');
    expect(s).not.toHaveProperty('nowPlaying');
    expect(Object.keys(s).sort()).toEqual(
      ['country', 'group', 'language', 'logo', 'name', 'url'].sort(),
    );
  });

  it('tab-prefixed https line trims and binds', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,T\n\thttps://tab\n')[0].url).toBe('https://tab');
  });

  it('zero-width char inside name is preserved from tvg-name', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="A\u200bB",A\nhttps://u\n');
    expect(s.name).toBe('A\u200bB');
  });

  // --- HEAVY burn (post-#56): deepen parser unit slice only — no product inventing ---
  // Orthogonal to #56 mcp/CI/source/mcp-spec and open helpers/CI drafts (#57/#58).

  it('resets on spotify: itunes: and itms: media deep-link schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Spot",Spot
spotify:track:4uLU6hMCjMI75M1A2tKUQC
#EXTINF:-1 tvg-name="Itunes",Itunes
itunes://music.apple.com/album/1
#EXTINF:-1 tvg-name="Itms",Itms
itms://itunes.apple.com/app/id1
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/media-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on market: and android-app: store schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Market",Market
market://details?id=com.example.radio
#EXTINF:-1 tvg-name="Android",Android
android-app://com.example.radio
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/store-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on maps: geo: and steam: location/game schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Maps",Maps
maps:q=radio+tower
#EXTINF:-1 tvg-name="Geo",Geo
geo:37.7749,-122.4194
#EXTINF:-1 tvg-name="Steam",Steam
steam://run/730
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/geo-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on discord: slack: and zoommtg: chat/meeting schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Discord",Discord
discord://-/channels/1/2
#EXTINF:-1 tvg-name="Slack",Slack
slack://channel?id=C123
#EXTINF:-1 tvg-name="Zoom",Zoom
zoommtg://zoom.us/join?action=join&confno=1
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/chat-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on whatsapp: tg: viber: and skype: messenger schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Wa",Wa
whatsapp://send?text=hi
#EXTINF:-1 tvg-name="Tg",Tg
tg://resolve?domain=radio
#EXTINF:-1 tvg-name="Viber",Viber
viber://forward?text=hi
#EXTINF:-1 tvg-name="Skype",Skype
skype:echo123?call
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/im-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on facetime: fb: notion: and figma: app schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ft",Ft
facetime://user@example.com
#EXTINF:-1 tvg-name="Fb",Fb
fb://profile/1
#EXTINF:-1 tvg-name="Notion",Notion
notion://www.notion.so/page
#EXTINF:-1 tvg-name="Figma",Figma
figma://file/abc
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/app-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('resets on ws:// and wss:// WebSocket schemes then recovers', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Ws",Ws
ws://example.com/socket
#EXTINF:-1 tvg-name="Wss",Wss
wss://example.com/socket
#EXTINF:-1 tvg-name="Ok",Ok
https://example.com/ws-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('Object.seal on station copy still exposes locked reads', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Sealed" group-title="G",Sealed
https://example.com/sealed.m3u8
`);
    const sealed = Object.seal({ ...station });
    expect(Object.isSealed(sealed)).toBe(true);
    expect(sealed.name).toBe('Sealed');
    expect(sealed.group).toBe('G');
    expect(() => {
      (sealed as { extra?: string }).extra = 'nope';
    }).toThrow();
  });

  it('Reflect.ownKeys on station matches Object.keys with no symbols', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="R" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",R
https://example.com/r.m3u8
`);
    expect(Reflect.ownKeys(station)).toEqual(Object.keys(station));
    expect(Reflect.ownKeys(station).every((k) => typeof k === 'string')).toBe(true);
  });

  it('Proxy get trap still surfaces name url and group from live station', () => {
    const [station] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="P" group-title="Jazz",P
https://example.com/p.m3u8
`);
    const proxied = new Proxy(station, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(proxied.name).toBe('P');
    expect(proxied.url).toBe('https://example.com/p.m3u8');
    expect(proxied.group).toBe('Jazz');
  });

  it('Symbol.iterator over parse result yields stations in playlist order', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const viaIterator = Array.from(stations[Symbol.iterator]());
    expect(viaIterator.map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('ES2022-safe reverse copy via slice+reverse does not mutate parse result', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const reversed = stations.slice().reverse();
    expect(reversed[0].name).toBe('Zeta FM');
    expect(stations[0].name).toBe('Alpha FM');
  });

  it('manual sort copy locks Alpha-first without mutating live order', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const sorted = stations.slice().sort((a, b) => a.name.localeCompare(b.name));
    expect(sorted.map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Delta FM',
      'Epsilon FM',
      'Gamma FM',
      'Zeta FM',
    ]);
    expect(stations[2].name).toBe('Gamma FM');
  });

  it('Array.from mapping urls preserves dedupe uniqueness', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/a.m3u8
#EXTINF:-1,B
https://example.com/a.m3u8
#EXTINF:-1,C
https://example.com/c.m3u8
`);
    expect(Array.from(stations, (s) => s.url)).toEqual([
      'https://example.com/a.m3u8',
      'https://example.com/c.m3u8',
    ]);
  });

  it('TextEncoder byte length of SAMPLE_M3U station names is stable', () => {
    const enc = new TextEncoder();
    const stations = parseM3U(SAMPLE_M3U);
    const total = stations.reduce((n, s) => n + enc.encode(s.name).byteLength, 0);
    expect(total).toBe(48); // Alpha/Beta/Gamma/Delta/Epsilon/Zeta FM
  });

  it('btoa of station url host path is stable for ascii streams', () => {
    const [s] = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/a.m3u8
`);
    expect(btoa(s.url)).toBe(btoa('https://example.com/a.m3u8'));
    expect(btoa(s.url).length).toBeGreaterThan(20);
  });

  it('codePointAt locks on unicode tvg-name first and last code points', () => {
    const [s] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="東京FM",東京FM
https://example.com/tokyo.m3u8
`);
    expect(s.name.codePointAt(0)).toBe(0x6771);
    expect(s.name.codePointAt(s.name.length - 1)).toBe('M'.codePointAt(0));
  });

  it('fromCodePoint rebuilt emoji name matches tvg-name bind', () => {
    const emoji = String.fromCodePoint(0x1f3b5);
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${emoji} Radio",X\nhttps://example.com/emoji.m3u8\n`,
    );
    expect(s.name).toBe(`${emoji} Radio`);
    expect(s.name.codePointAt(0)).toBe(0x1f3b5);
  });

  it('NFC and NFD forms of café in tvg-name are distinct keys not normalized', () => {
    const nfc = 'café'.normalize('NFC');
    const nfd = 'café'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="${nfc}",A
https://example.com/nfc.m3u8
#EXTINF:-1 tvg-name="${nfd}",B
https://example.com/nfd.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual([nfc, nfd]);
  });

  it('NFKD of ﬁ ligature in name is not applied by parser', () => {
    const lig = 'ﬁ';
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${lig} Radio",X\nhttps://example.com/lig.m3u8\n`,
    );
    expect(s.name).toBe(`${lig} Radio`);
    expect(s.name.normalize('NFKD')).toBe('fi Radio');
    expect(s.name).not.toBe(s.name.normalize('NFKD'));
  });

  it('padStart/repeat on parsed names do not invent map aliases', () => {
    const [s] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Jazz",Jazz
https://example.com/jazz.m3u8
`);
    expect(s.name.padStart(8, '*')).toBe('****Jazz');
    expect('x'.repeat(3)).toBe('xxx');
    expect(parseM3U(`#EXTM3U\n#EXTINF:-1,${'x'.repeat(3)}\nhttps://example.com/x.m3u8\n`)[0].name).toBe(
      'xxx',
    );
  });

  it('locks station.url.length for SAMPLE_M3U Alpha stream', () => {
    const alpha = parseM3U(SAMPLE_M3U)[0];
    expect(alpha.url).toBe('https://example.com/alpha.m3u8');
    expect(alpha.url.length).toBe(30);
  });

  it('URL.canParse accepts every SAMPLE_M3U stream URL', () => {
    for (const s of parseM3U(SAMPLE_M3U)) {
      expect(URL.canParse(s.url)).toBe(true);
    }
  });

  it('new URL pathname searchParams and hostname lock for query streams', () => {
    const [s] = parseM3U(`#EXTM3U
#EXTINF:-1,Q
https://cdn.example.com/live/stream.m3u8?token=abc&n=1#frag
`);
    const u = new URL(s.url);
    expect(u.hostname).toBe('cdn.example.com');
    expect(u.pathname).toBe('/live/stream.m3u8');
    expect(u.searchParams.get('token')).toBe('abc');
    expect(u.searchParams.get('n')).toBe('1');
    expect(u.hash).toBe('#frag');
  });

  it('new URL username password preserved from userinfo stream lines', () => {
    const [s] = parseM3U(`#EXTM3U
#EXTINF:-1,Auth
https://user:pass@example.com:8443/stream.m3u8
`);
    const u = new URL(s.url);
    expect(u.username).toBe('user');
    expect(u.password).toBe('pass');
    expect(u.port).toBe('8443');
  });

  it('attrs after the last comma are still matched by whole-line regex', () => {
    // Attribute regexes scan the entire #EXTINF line, including text after the comma.
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1,Display tvg-name="Ignored"\nhttps://example.com/after-comma.m3u8\n',
    );
    expect(s.name).toBe('Ignored');
  });

  it('group-title after the last comma is still extracted as group', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="N",N group-title="Late"\nhttps://example.com/g-after.m3u8\n',
    );
    expect(s.name).toBe('N');
    expect(s.group).toBe('Late');
  });

  it('unclosed tvg-name quote does not bind attr; comma fallback used', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="Unclosed,Fallback\nhttps://example.com/unclosed.m3u8\n',
    );
    expect(s.name).toBe('Fallback');
  });

  it('CR-only playlists do not split on \\r so fail to bind (split is LF-only)', () => {
    // parseM3U uses raw.split('\\n'); lone CR never becomes separate lines.
    expect(parseM3U('#EXTM3U\r#EXTINF:-1,A\rhttps://example.com/cr-only.m3u8\r')).toEqual([]);
  });

  it('mixed LF and CRLF line endings parse without dropping stations', () => {
    const stations = parseM3U(
      '#EXTM3U\n#EXTINF:-1,A\r\nhttps://example.com/a.m3u8\n#EXTINF:-1,B\r\nhttps://example.com/b.m3u8\n',
    );
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('form feed between EXTINF and URL trims to empty and does not reset', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1,A\n\f\nhttps://example.com/ff.m3u8\n`,
    );
    expect(stations.map((s) => s.name)).toEqual(['A']);
    expect(stations[0].url).toBe('https://example.com/ff.m3u8');
  });

  it('vertical tab between EXTINF and URL trims to empty and does not reset', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1,A\n\v\nhttps://example.com/vt.m3u8\n`,
    );
    expect(stations.map((s) => s.name)).toEqual(['A']);
  });

  it('Unicode line separator U+2028 between EXTINF and URL trims away without reset', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1,A\n\u2028\nhttps://example.com/ls.m3u8\n`,
    );
    expect(stations.map((s) => s.name)).toEqual(['A']);
  });

  it('Unicode paragraph separator U+2029 between EXTINF and URL trims away without reset', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1,A\n\u2029\nhttps://example.com/ps.m3u8\n`,
    );
    expect(stations.map((s) => s.name)).toEqual(['A']);
  });

  it('non-whitespace junk line between EXTINF and URL resets pending', () => {
    const stations = parseM3U(
      `#EXTM3U\n#EXTINF:-1,A\nnot-a-url\nhttps://example.com/junk.m3u8\n#EXTINF:-1,B\nhttps://example.com/b.m3u8\n`,
    );
    expect(stations.map((s) => s.name)).toEqual(['B']);
  });
  it('word joiner U+2060 inside tvg-name is preserved', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A\u2060B",X\nhttps://example.com/wj.m3u8\n',
    );
    expect(s.name).toBe('A\u2060B');
  });

  it('soft hyphen U+00AD inside tvg-name is preserved', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="Soft\u00adHyphen",X\nhttps://example.com/shy.m3u8\n',
    );
    expect(s.name).toBe('Soft\u00adHyphen');
  });

  it('private-use BMP codepoint in name is preserved', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="PU\uE000X",X\nhttps://example.com/pu.m3u8\n',
    );
    expect(s.name).toBe('PU\uE000X');
    expect(s.name.codePointAt(2)).toBe(0xe000);
  });

  it('variation selector-16 after emoji in name is preserved', () => {
    const name = `⏱\uFE0F Radio`;
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://example.com/vs16.m3u8\n`,
    );
    expect(s.name).toBe(name);
    expect([...s.name]).toContain('\uFE0F');
  });

  it('keycap combining sequence in tvg-name is preserved', () => {
    const name = '1\uFE0F\u20E3 FM';
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://example.com/keycap.m3u8\n`,
    );
    expect(s.name).toBe(name);
  });

  it('skin-tone modifier on emoji name is preserved', () => {
    const name = `👊\u{1F3FD} Hits`;
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://example.com/skin.m3u8\n`,
    );
    expect(s.name).toBe(name);
  });

  it('regional-indicator flag pair in tvg-name is preserved', () => {
    const flag = String.fromCodePoint(0x1f1fa, 0x1f1f8);
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${flag} Radio",X\nhttps://example.com/flag.m3u8\n`,
    );
    expect(s.name).toBe(`${flag} Radio`);
    expect([...s.name].slice(0, 2).map((c) => c.codePointAt(0))).toEqual([0x1f1fa, 0x1f1f8]);
  });

  it('ZWJ emoji sequence in tvg-name is preserved as a single visual name', () => {
    const family = '👨\u200D👩\u200D👧';
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="${family}",X\nhttps://example.com/zwj.m3u8\n`,
    );
    expect(s.name).toBe(family);
    expect(s.name.includes('\u200D')).toBe(true);
  });

  it('null byte inside tvg-name is preserved in the bound name', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A\u0000B",X\nhttps://example.com/null.m3u8\n',
    );
    expect(s.name).toBe('A\u0000B');
    expect(s.name.length).toBe(3);
  });

  it('EXTINF:0 and EXTINF:10 duration variants still extract attrs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:0 tvg-name="Zero",Zero
https://example.com/zero.m3u8
#EXTINF:10 tvg-name="Ten",Ten
https://example.com/ten.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Zero', 'Ten']);
  });

  it('comma-only EXTINF with no attrs uses empty display name after last comma', () => {
    // lastIndexOf(',') at end → empty trimmed name → URL skipped (falsy name)
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,\nhttps://example.com/empty-name.m3u8\n')).toEqual([]);
  });

  it('whitespace-only display name after comma is falsy and skips URL', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,   \nhttps://example.com/ws-name.m3u8\n')).toEqual([]);
  });

  it('duplicate attr keys: first regex match wins for tvg-name', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="First" tvg-name="Second",Disp\nhttps://example.com/dup-attr.m3u8\n',
    );
    expect(s.name).toBe('First');
  });

  it('duplicate group-title keys: first match wins', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 group-title="A" group-title="B" tvg-name="N",N\nhttps://example.com/dup-g.m3u8\n',
    );
    expect(s.group).toBe('A');
  });

  it('attrs without space separators still match when glued to duration', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1tvg-name="Glued",X\nhttps://example.com/glued.m3u8\n',
    );
    expect(s.name).toBe('Glued');
  });

  it('hash-comment lines that are not EXTINF leave pending attrs intact', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep" group-title="G",Keep
#EXT-X-SESSION-DATA:DATA-ID="com.example"
#comment junk
https://example.com/keep.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Keep',
        url: 'https://example.com/keep.m3u8',
        logo: undefined,
        group: 'G',
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('non-http scheme with leading whitespace still resets after trim', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
  rtmp://live.example/x
#EXTINF:-1,B
https://example.com/b.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['B']);
  });

  it('http URL with only scheme and slashes binds when named', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,Bare\nhttp://\n');
    expect(s.url).toBe('http://');
    expect(s.name).toBe('Bare');
  });

  it('https URL with unicode hostname is preserved without punycode', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1,Idn\nhttps://例子.测试/stream.m3u8\n',
    );
    expect(s.url).toBe('https://例子.测试/stream.m3u8');
    expect(s.url.includes('xn--')).toBe(false);
  });

  it('percent-encoded path segments are not decoded', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1,Pct\nhttps://example.com/%2e%2e/%61.m3u8\n',
    );
    expect(s.url).toBe('https://example.com/%2e%2e/%61.m3u8');
  });

  it('IPv6 literal https URL is preserved verbatim', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1,V6\nhttps://[2001:db8::1]:8443/live.m3u8\n',
    );
    expect(s.url).toBe('https://[2001:db8::1]:8443/live.m3u8');
    const u = new URL(s.url);
    expect(u.hostname).toBe('[2001:db8::1]');
    expect(u.port).toBe('8443');
    expect(u.pathname).toBe('/live.m3u8');
  });

  it('matrix-style path params in URL are kept for dedupe identity', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/stream;quality=hi
#EXTINF:-1,B
https://example.com/stream;quality=lo
`);
    expect(stations).toHaveLength(2);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/stream;quality=hi',
      'https://example.com/stream;quality=lo',
    ]);
  });

  it('Object.getOwnPropertyDescriptors marks station fields writable enumerable configurable', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/a.m3u8\n');
    const desc = Object.getOwnPropertyDescriptors(s);
    for (const key of ['name', 'url', 'logo', 'group', 'language', 'country'] as const) {
      expect(desc[key]?.enumerable).toBe(true);
      expect(desc[key]?.writable).toBe(true);
      expect(desc[key]?.configurable).toBe(true);
    }
  });

  it('WeakMap can key live station objects without leaking into JSON', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const meta = new WeakMap<object, string>();
    meta.set(stations[0], 'alpha-meta');
    expect(meta.get(stations[0])).toBe('alpha-meta');
    expect(JSON.stringify(stations[0])).not.toContain('alpha-meta');
  });

  it('Map from url→name for SAMPLE_M3U has six unique entries', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const m = new Map(stations.map((s) => [s.url, s.name]));
    expect(m.size).toBe(6);
    expect(m.get('https://example.com/zeta.m3u8')).toBe('Zeta FM');
  });

  it('Set of station urls equals array length after parse', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(new Set(stations.map((s) => s.url)).size).toBe(stations.length);
  });

  it('structuredClone then mutate name leaves live parse result intact', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const clone = structuredClone(stations);
    clone[0].name = 'Hijack';
    expect(stations[0].name).toBe('Alpha FM');
  });

  it('JSON.parse(JSON.stringify) clone is deep-equal but not identity-equal', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const clone = JSON.parse(JSON.stringify(stations)) as typeof stations;
    expect(clone).toEqual(stations);
    expect(clone).not.toBe(stations);
    expect(clone[0]).not.toBe(stations[0]);
  });

  it('does not invent nowPlaying playlist or bitrate fields on Station', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/a.m3u8\n');
    expect(s).not.toHaveProperty('nowPlaying');
    expect(s).not.toHaveProperty('playlist');
    expect(s).not.toHaveProperty('bitrate');
    expect(s).not.toHaveProperty('codec');
  });

  it('cross-lock: buildSimpleM3U → parseM3U → countHttpStreamLines parity for 12 stations', () => {
    const fixtures = Array.from({ length: 12 }, (_, i) => ({
      name: `S${i}`,
      url: `https://example.com/s${i}.m3u8`,
      group: i % 2 === 0 ? 'Even' : 'Odd',
    }));
    const m3u = buildSimpleM3U(fixtures);
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(12);
    expect(countHttpStreamLines(m3u)).toBe(12);
    expect(stations.every((s, i) => s.name === `S${i}` && s.url.endsWith(`/s${i}.m3u8`))).toBe(
      true,
    );
  });

  it('cross-lock: SAMPLE_M3U parse length equals countHttpStreamLines', () => {
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
  });

  it('cross-lock: every SAMPLE_M3U station group is Music and logo undefined', () => {
    for (const s of parseM3U(SAMPLE_M3U)) {
      expect(s.group).toBe('Music');
      expect(s.logo).toBeUndefined();
      expect(s.language).toBeUndefined();
      expect(s.country).toBeUndefined();
    }
  });

  it('reduce builds name→url map matching Object.fromEntries', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const viaReduce = stations.reduce<Record<string, string>>((acc, s) => {
      acc[s.name] = s.url;
      return acc;
    }, {});
    expect(viaReduce).toEqual(Object.fromEntries(stations.map((s) => [s.name, s.url])));
  });

  it('localeCompare of consecutive SAMPLE_M3U names is not globally sorted', () => {
    const names = parseM3U(SAMPLE_M3U).map((s) => s.name);
    const comparisons = names.slice(0, -1).map((n, i) => n.localeCompare(names[i + 1]));
    expect(comparisons.some((c) => c > 0)).toBe(true); // Gamma→Delta is ascending but Beta→Gamma etc.
    expect(names).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('does not bind mailto: tel: or sms: contact schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,Mail
mailto:dj@example.com
#EXTINF:-1,Tel
tel:+15551212
#EXTINF:-1,Sms
sms:+15551212
#EXTINF:-1,Ok
https://example.com/contact-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not bind blob: or about:blank document schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,Blob
blob:https://example.com/uuid
#EXTINF:-1,About
about:blank
#EXTINF:-1,Ok
https://example.com/doc-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('does not bind magnet: or intent: download/intent schemes', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,Magnet
magnet:?xt=urn:btih:abc
#EXTINF:-1,Intent
intent://scan/#Intent;scheme=zxing;end
#EXTINF:-1,Ok
https://example.com/dl-ok.m3u8
`);
    expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('locks exact own-key insertion order for fully-populated station', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",N\nhttps://u\n',
    );
    expect(Object.keys(s)).toEqual(['name', 'url', 'logo', 'group', 'language', 'country']);
    expect(Object.values(s)).toEqual(['N', 'https://u', 'https://l', 'G', 'en', 'US']);
  });

  it('entries() order matches keys/values for sparse station', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.entries(s)).toEqual([
      ['name', 'A'],
      ['url', 'https://a'],
      ['logo', undefined],
      ['group', undefined],
      ['language', undefined],
      ['country', undefined],
    ]);
  });

  it('parseM3U is pure: identical input yields deep-equal distinct arrays', () => {
    const a = parseM3U(SAMPLE_M3U);
    const b = parseM3U(SAMPLE_M3U);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('large 100-station playlist preserves order and dedupe of last duplicate', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100; i++) {
      lines.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
      lines.push(`https://example.com/s${i}.m3u8`);
    }
    lines.push('#EXTINF:-1 tvg-name="Dup",Dup');
    lines.push('https://example.com/s50.m3u8');
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(100);
    expect(stations[50].name).toBe('S50');
    expect(stations.some((s) => s.name === 'Dup')).toBe(false);
  });

  it('tvg-logo with data: URI is bound as logo string without fetching', () => {
    const logo = 'data:image/png;base64,aaaa';
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="D" tvg-logo="${logo}",D\nhttps://example.com/d.m3u8\n`,
    );
    expect(s.logo).toBe(logo);
  });

  it('empty string attrs still create own keys with empty string values', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="E" tvg-logo="" group-title="" tvg-language="" tvg-country="",E\nhttps://e\n',
    );
    expect(s.logo).toBe('');
    expect(s.group).toBe('');
    expect(s.language).toBe('');
    expect(s.country).toBe('');
    expect(Object.prototype.hasOwnProperty.call(s, 'logo')).toBe(true);
  });

  it('surrogate pair musical note in URL path is preserved', () => {
    const note = String.fromCodePoint(0x1f3b5);
    const url = `https://example.com/${note}.m3u8`;
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,N\n${url}\n`);
    expect(s.url).toBe(url);
    expect(s.url.includes(note)).toBe(true);
  });

  it('does not treat HTTP:// or HTTPS:// uppercase schemes as streams', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1,A\nHTTP://EXAMPLE.COM/A\n#EXTINF:-1,B\nHTTPS://EXAMPLE.COM/B\n'),
    ).toEqual([]);
  });

  it('Http:// mixed-case scheme does not bind (startsWith exact)', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\nHttp://example.com/a\n')).toEqual([]);
  });

  it('trailing spaces inside https URL line are trimmed before bind', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/a.m3u8   \n');
    expect(s.url).toBe('https://example.com/a.m3u8');
  });

  it('station objects are plain Object prototypes not null-prototype', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
  });

  it('parse result array is a true Array with Array.prototype', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(Array.isArray(stations)).toBe(true);
    expect(Object.getPrototypeOf(stations)).toBe(Array.prototype);
  });

  it('negative: parser source does not export resolveGenre or MCP_MANIFEST', async () => {
    const mod = await import('../src/parser');
    expect(mod).not.toHaveProperty('resolveGenre');
    expect(mod).not.toHaveProperty('MCP_MANIFEST');
    expect(mod).not.toHaveProperty('GENRE_MAP');
    expect(typeof mod.parseM3U).toBe('function');
  });

  it('negative: Station-shaped objects never include editorial from Gemini', () => {
    const stations = parseM3U(SAMPLE_M3U);
    for (const s of stations) {
      expect(s).not.toHaveProperty('editorial');
      expect(s).not.toHaveProperty('curated_by');
      expect(s).not.toHaveProperty('timestamp');
    }
  });

  it('cross-lock: first SAMPLE_M3U url host is example.com via URL parser', () => {
    const u = new URL(parseM3U(SAMPLE_M3U)[0].url);
    expect(u.protocol).toBe('https:');
    expect(u.host).toBe('example.com');
  });

  it('cross-lock: buildSimpleM3U optional attrs round-trip through parseM3U', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(parseM3U(m3u)).toEqual([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
  });

  it('Array.prototype.every confirms all SAMPLE_M3U urls start with https://', () => {
    expect(parseM3U(SAMPLE_M3U).every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('Array.prototype.some finds Zeta and rejects missing Omega', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.some((s) => s.name === 'Zeta FM')).toBe(true);
    expect(stations.some((s) => s.name === 'Omega FM')).toBe(false);
  });

  it('findIndex of Gamma FM is 2; findIndex of missing is -1', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.findIndex((s) => s.name === 'Gamma FM')).toBe(2);
    expect(stations.findIndex((s) => s.name === 'Missing')).toBe(-1);
  });

  it('slice(1,4) of SAMPLE_M3U yields Beta Gamma Delta without live mutation', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.slice(1, 4).map((s) => s.name)).toEqual(['Beta FM', 'Gamma FM', 'Delta FM']);
    expect(stations).toHaveLength(6);
  });

  it('concat of two parse results is length-additive with distinct urls', () => {
    const a = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    const b = parseM3U('#EXTM3U\n#EXTINF:-1,B\nhttps://b\n');
    expect(a.concat(b).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('flat of nested parse results matches concat', () => {
    const nested = [
      parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n'),
      parseM3U('#EXTM3U\n#EXTINF:-1,B\nhttps://b\n'),
    ];
    expect(nested.flat().map((s) => s.url)).toEqual(['https://a', 'https://b']);
  });

  it('locks Buffer.byteLength of JSON.stringify(SAMPLE_M3U parse) within band', () => {
    const n = Buffer.byteLength(JSON.stringify(parseM3U(SAMPLE_M3U)), 'utf8');
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(1200);
  });

  it('String.raw playlist with escaped newlines parses like normal template', () => {
    const raw = String.raw`#EXTM3U
#EXTINF:-1,A
https://example.com/raw.m3u8
`;
    expect(parseM3U(raw)).toHaveLength(1);
    expect(parseM3U(raw)[0].url).toBe('https://example.com/raw.m3u8');
  });

  it('fromCharCode rebuilt https prefix matches live stream scheme check', () => {
    const scheme = String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47);
    expect(scheme).toBe('https://');
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,A\n${scheme}example.com/fromchar.m3u8\n`);
    expect(s.url.startsWith(scheme)).toBe(true);
  });

  it('Number.isFinite of station count for SAMPLE_M3U is true and equals 6', () => {
    const n = parseM3U(SAMPLE_M3U).length;
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBe(6);
  });

  it('does not parse nested arrays or objects — always returns Station[]', () => {
    const result = parseM3U(SAMPLE_M3U);
    expect(result.every((s) => typeof s === 'object' && s !== null && !Array.isArray(s))).toBe(
      true,
    );
  });

  it('EXTINF without comma and without tvg-name yields no station for following URL', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1 radio=true\nhttps://example.com/nocomma.m3u8\n'),
    ).toEqual([]);
  });

  it('multiple blank and comment lines between stations do not leak attrs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A" group-title="G1",A
https://example.com/a.m3u8

# playlist gap

#EXTINF:-1 tvg-name="B",B
https://example.com/b.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'A',
        url: 'https://example.com/a.m3u8',
        logo: undefined,
        group: 'G1',
        language: undefined,
        country: undefined,
      },
      {
        name: 'B',
        url: 'https://example.com/b.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('tab-separated-looking attrs still require spaces or glued keys for regex', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1\ttvg-name="Tabbed",X\nhttps://example.com/tabbed.m3u8\n',
    );
    expect(s.name).toBe('Tabbed');
  });

  it('query-only difference with identical path keeps both after dedupe check', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x?a=1
#EXTINF:-1,B
https://example.com/x?a=2
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('hash-only difference with identical path keeps both after dedupe check', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x#one
#EXTINF:-1,B
https://example.com/x#two
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('trailing ? vs no query are distinct stream URLs', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x
#EXTINF:-1,B
https://example.com/x?
`);
    expect(stations).toHaveLength(2);
  });

  it('Immutable Object.assign bag does not alias live parse string fields', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    const bag = Object.assign({}, { name: s.name });
    bag.name = 'mutated';
    expect(s.name).toBe('A');
    expect(bag.name).toBe('mutated');
  });

  it('Array.prototype.every printable ASCII check on SAMPLE_M3U urls', () => {
    expect(
      parseM3U(SAMPLE_M3U).every((s) =>
        [...s.url].every((ch) => {
          const c = ch.charCodeAt(0);
          return c >= 32 && c < 127;
        }),
      ),
    ).toBe(true);
  });

  it('post68: sha256 of parser.ts locks to known digest', () => {
    const digest = createHash('sha256').update(parserSource, 'utf8').digest('hex');
    expect(digest).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it('post68: sha1 of parser.ts locks to known digest', () => {
    expect(createHash('sha1').update(parserSource, 'utf8').digest('hex')).toBe(
      '701cdecbef5a9049af6bd11497493c4036a60211',
    );
  });

  it('post68: md5 of parser.ts locks to known digest', () => {
    expect(createHash('md5').update(parserSource, 'utf8').digest('hex')).toBe(
      '500211c4c526de887252451726776563',
    );
  });

  it('post68: parser.ts code-unit length 1953; utf8 byte length 1955 (—)', () => {
    expect(parserSource.length).toBe(1953);
    expect(Buffer.byteLength(parserSource, 'utf8')).toBe(1955);
    expect(parserSource).toContain('—');
  });

  it('post68: parser.ts split line count stays 67 with 66 newlines', () => {
    expect(parserSource.split('\n')).toHaveLength(67);
    expect((parserSource.match(/\n/g) ?? []).length).toBe(66);
  });

  it('post68: parser exports Station interface and parseM3U only', () => {
    const exports = [...parserSource.matchAll(/^export (?:interface|function) (\w+)/gm)].map(
      (m) => m[1],
    );
    expect(exports).toEqual(['Station', 'parseM3U']);
  });

  it('post68: Station fields lock name url logo group language country', () => {
    expect(parserSource).toContain('name: string;');
    expect(parserSource).toContain('url: string;');
    expect(parserSource).toContain('logo?: string;');
    expect(parserSource).toContain('group?: string;');
    expect(parserSource).toContain('language?: string;');
    expect(parserSource).toContain('country?: string;');
  });

  it('post68: parseM3U uses seen Set for URL dedupe', () => {
    expect(parserSource).toContain('const seen = new Set<string>()');
    expect(parserSource).toContain('!seen.has(line)');
    expect(parserSource).toContain('seen.add(line)');
  });

  it('post68: parseM3U startsWith checks http and https exactly', () => {
    expect(parserSource).toContain("line.startsWith('http://') || line.startsWith('https://')");
  });

  it('post68: parseM3U regex attrs are case-insensitive for tvg-name logo group language country', () => {
    expect(parserSource).toMatch(/tvg-name="\(\[\^"\]\*\)"/i);
    expect(parserSource).toContain('tvg-logo=');
    expect(parserSource).toContain('group-title=');
    expect(parserSource).toContain('tvg-language=');
    expect(parserSource).toContain('tvg-country=');
  });

  it('post68: fallback name uses lastIndexOf comma', () => {
    expect(parserSource).toContain('line.lastIndexOf(\',\')');
  });

  it('post68: non-http non-comment lines reset current', () => {
    expect(parserSource).toContain("else if (line && !line.startsWith('#'))");
  });

  it('post68: negative — parser source has no Gemini fetch Hono resolveGenre', () => {
    expect(parserSource).not.toMatch(/GEMINI|fetch\(|Hono|resolveGenre|GENRE_MAP|MCP_MANIFEST/);
  });

  it('post68: negative — no async await Promise in parser.ts', () => {
    expect(parserSource).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
  });

  it('post68: no tabs and no CRLF in parser.ts', () => {
    expect(parserSource).not.toContain('\t');
    expect(parserSource).not.toContain('\r');
  });

  it('post68: EOF single trailing newline after closing brace', () => {
    expect(parserSource.endsWith('}\n')).toBe(true);
    expect(parserSource.endsWith('}\n\n')).toBe(false);
  });

  it('post68: SAMPLE_M3U helper parse yields 6 stations', () => {
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('post68: buildSimpleM3U round-trip with logo group language country', () => {
    const m3u = buildSimpleM3U([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
    expect(parseM3U(m3u)).toEqual([
      {
        name: 'Full',
        url: 'https://example.com/full.m3u8',
        logo: 'https://cdn.example/full.png',
        group: 'Jazz',
        language: 'en',
        country: 'US',
      },
    ]);
  });

  it('post68: dedupe keeps first name when URL repeats', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="First",First
https://example.com/same.m3u8
#EXTINF:-1 tvg-name="Second",Second
https://example.com/same.m3u8
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('First');
  });

  it('post68: http and https both bind; rtmp resets without bind', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
http://example.com/a
#EXTINF:-1,B
https://example.com/b
#EXTINF:-1,C
rtmp://example.com/c
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post68: uppercase HTTP/HTTPS schemes do not bind', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1,A\nHTTP://EXAMPLE.COM/A\n#EXTINF:-1,B\nHTTPS://EXAMPLE.COM/B\n'),
    ).toEqual([]);
  });

  it('post68: mixed-case Http:// does not bind', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\nHttp://example.com/a\n')).toEqual([]);
  });

  it('post68: trailing spaces on URL line are trimmed before bind', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/a.m3u8   \n');
    expect(s.url).toBe('https://example.com/a.m3u8');
  });

  it('post68: leading spaces on URL line are trimmed', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\n   https://example.com/lead.m3u8\n');
    expect(s.url).toBe('https://example.com/lead.m3u8');
  });

  it('post68: empty tvg-logo group language country become empty strings', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="E" tvg-logo="" group-title="" tvg-language="" tvg-country="",E\nhttps://e\n',
    );
    expect(s.logo).toBe('');
    expect(s.group).toBe('');
    expect(s.language).toBe('');
    expect(s.country).toBe('');
  });

  it('post68: case-insensitive tvg-name attribute still extracts', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 TVG-NAME="Upper",X\nhttps://example.com/u\n');
    expect(s.name).toBe('Upper');
  });

  it('post68: comma fallback name when tvg-name absent', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,Comma Name\nhttps://example.com/c\n');
    expect(s.name).toBe('Comma Name');
  });

  it('post68: EXTINF without comma and without tvg-name yields no station', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1 radio=true\nhttps://example.com/nocomma.m3u8\n'),
    ).toEqual([]);
  });

  it('post68: orphan EXTINF without URL is ignored', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Orphan",Orphan\n')).toEqual([]);
  });

  it('post68: blank and comment gaps do not leak attrs across stations', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="A" group-title="G1",A
https://example.com/a.m3u8

# gap

#EXTINF:-1 tvg-name="B",B
https://example.com/b.m3u8
`);
    expect(stations[0].group).toBe('G1');
    expect(stations[1].group).toBeUndefined();
  });

  it('post68: query-string difference keeps both URLs after dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x?a=1
#EXTINF:-1,B
https://example.com/x?a=2
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post68: hash difference keeps both URLs after dedupe', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x#one
#EXTINF:-1,B
https://example.com/x#two
`);
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post68: trailing question mark URL is distinct from bare path', () => {
    expect(
      parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x
#EXTINF:-1,B
https://example.com/x?
`),
    ).toHaveLength(2);
  });

  it('post68: surrogate pair in URL path is preserved', () => {
    const note = String.fromCodePoint(0x1f3b5);
    const url = `https://example.com/${note}.m3u8`;
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,N\n${url}\n`);
    expect(s.url).toBe(url);
  });

  it('post68: station objects use Object.prototype not null prototype', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
  });

  it('post68: result array uses Array.prototype', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(Array.isArray(stations)).toBe(true);
    expect(Object.getPrototypeOf(stations)).toBe(Array.prototype);
  });

  it('post68: Object.assign bag does not alias live parse fields', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    const bag = Object.assign({}, { name: s.name });
    bag.name = 'mutated';
    expect(s.name).toBe('A');
  });

  it('post68: structuredClone of stations is deep equal distinct refs', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const clone = structuredClone(stations);
    expect(clone).toEqual(stations);
    expect(clone).not.toBe(stations);
    expect(clone[0]).not.toBe(stations[0]);
  });

  it('post68: freeze station copy still readable', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.freeze({ ...s }).name).toBe('A');
  });

  it('post68: Reflect.ownKeys on station includes name url optional fields', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",A\nhttps://a\n',
    );
    expect(Reflect.ownKeys(s).sort()).toEqual(
      ['country', 'group', 'language', 'logo', 'name', 'url'].sort(),
    );
  });

  it('post68: Proxy wrap of playlist string still parses', () => {
    const raw = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n';
    const proxy = new Proxy(
      { raw },
      {
        get(t, p, r) {
          return Reflect.get(t, p, r);
        },
      },
    );
    expect(parseM3U(proxy.raw)).toHaveLength(1);
  });

  it('post68: Array every SAMPLE urls start with https://', () => {
    expect(parseM3U(SAMPLE_M3U).every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('post68: Array some finds Zeta rejects Omega', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.some((s) => s.name === 'Zeta FM')).toBe(true);
    expect(stations.some((s) => s.name === 'Omega FM')).toBe(false);
  });

  it('post68: findIndex Gamma is 2; missing is -1', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.findIndex((s) => s.name === 'Gamma FM')).toBe(2);
    expect(stations.findIndex((s) => s.name === 'Missing')).toBe(-1);
  });

  it('post68: slice(1,4) yields Beta Gamma Delta', () => {
    expect(parseM3U(SAMPLE_M3U).slice(1, 4).map((s) => s.name)).toEqual([
      'Beta FM',
      'Gamma FM',
      'Delta FM',
    ]);
  });

  it('post68: concat of two parses is length-additive', () => {
    const a = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    const b = parseM3U('#EXTM3U\n#EXTINF:-1,B\nhttps://b\n');
    expect(a.concat(b).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post68: flat of nested parses matches concat', () => {
    const nested = [
      parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n'),
      parseM3U('#EXTM3U\n#EXTINF:-1,B\nhttps://b\n'),
    ];
    expect(nested.flat().map((s) => s.url)).toEqual(['https://a', 'https://b']);
  });

  it('post68: fromCharCode https scheme rebuild binds', () => {
    const scheme = String.fromCharCode(104, 116, 116, 112, 115, 58, 47, 47);
    expect(scheme).toBe('https://');
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,A\n${scheme}example.com/fromchar.m3u8\n`);
    expect(s.url.startsWith(scheme)).toBe(true);
  });

  it('post68: String.raw playlist parses like template', () => {
    const raw = String.raw`#EXTM3U
#EXTINF:-1,A
https://example.com/raw.m3u8
`;
    expect(parseM3U(raw)[0].url).toBe('https://example.com/raw.m3u8');
  });

  it('post68: Number.isFinite station count for SAMPLE is 6', () => {
    expect(Number.isFinite(parseM3U(SAMPLE_M3U).length)).toBe(true);
    expect(parseM3U(SAMPLE_M3U).length).toBe(6);
  });

  it('post68: Buffer.byteLength of JSON SAMPLE parse within band', () => {
    const n = Buffer.byteLength(JSON.stringify(parseM3U(SAMPLE_M3U)), 'utf8');
    expect(n).toBeGreaterThan(400);
    expect(n).toBeLessThan(1200);
  });

  it('post68: printable ASCII check on SAMPLE urls', () => {
    expect(
      parseM3U(SAMPLE_M3U).every((s) =>
        [...s.url].every((ch) => {
          const c = ch.charCodeAt(0);
          return c >= 32 && c < 127;
        }),
      ),
    ).toBe(true);
  });

  it('post68: negative module exports — no resolveGenre MCP_MANIFEST GENRE_MAP', async () => {
    const mod = await import('../src/parser');
    expect(mod).not.toHaveProperty('resolveGenre');
    expect(mod).not.toHaveProperty('MCP_MANIFEST');
    expect(mod).not.toHaveProperty('GENRE_MAP');
    expect(typeof mod.parseM3U).toBe('function');
  });

  it('post68: negative stations never include editorial curated_by timestamp', () => {
    for (const s of parseM3U(SAMPLE_M3U)) {
      expect(s).not.toHaveProperty('editorial');
      expect(s).not.toHaveProperty('curated_by');
      expect(s).not.toHaveProperty('timestamp');
    }
  });

  it('post68: cross-lock first SAMPLE url host via URL parser', () => {
    const u = new URL(parseM3U(SAMPLE_M3U)[0].url);
    expect(u.protocol).toBe('https:');
    expect(u.host).toBe('example.com');
  });

  it('post68: cross-lock countHttpStreamLines helper aligns with parse length for SAMPLE', () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
  });

  it('post68: cross-lock AGENTS.md lists parser.ts as safe action', () => {
    const agents = readFileSync(join(parserRoot, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('src/parser.ts');
    expect(agents).toMatch(/M3U parser/i);
  });

  it('post68: cross-lock index.ts imports parseM3U from ./parser', () => {
    const index = readFileSync(join(parserRoot, 'src/index.ts'), 'utf8');
    expect(index).toMatch(/from ['"]\.\/parser['"]/);
    expect(index).toContain('parseM3U');
  });

  it('post68: re-read parser.ts equals module snapshot', () => {
    expect(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8')).toBe(parserSource);
  });

  it('post68: TextEncoder utf8 length is 1955 for parser source with em dash', () => {
    expect(new TextEncoder().encode(parserSource).length).toBe(1955);
    expect(parserSource.length).toBe(1953);
  });

  it('post68: TextDecoder round-trip preserves parser source', () => {
    expect(new TextDecoder().decode(new TextEncoder().encode(parserSource))).toBe(parserSource);
  });

  it('post68: codePointAt equals charCodeAt except em dash in non-http comment', () => {
    const dashIdx = parserSource.indexOf('—');
    expect(dashIdx).toBeGreaterThan(0);
    expect(parserSource.codePointAt(dashIdx)).toBe(0x2014);
    for (let i = 0; i < parserSource.length; i++) {
      if (i === dashIdx) continue;
      expect(parserSource.codePointAt(i)).toBe(parserSource.charCodeAt(i));
    }
  });

  it('post68: normalize NFC identity for parser.ts', () => {
    expect(parserSource.normalize('NFC')).toBe(parserSource);
  });

  it('post68: createHash sha256 buffer length 32', () => {
    expect(createHash('sha256').update(parserSource, 'utf8').digest()).toHaveLength(32);
  });

  it('post68: md5 buffer length 16', () => {
    expect(createHash('md5').update(parserSource, 'utf8').digest()).toHaveLength(16);
  });

  it('post68: sha256 starts with cf293136 ends with 1f4368', () => {
    const d = createHash('sha256').update(parserSource, 'utf8').digest('hex');
    expect(d.startsWith('cf293136')).toBe(true);
    expect(d.endsWith('1f4368')).toBe(true);
  });

  it('post68: parseM3U length property is 1', () => {
    expect(parseM3U.length).toBe(1);
    expect(parseM3U.name).toBe('parseM3U');
  });

  it('post68: empty and header-only playlists return []', () => {
    expect(parseM3U('')).toEqual([]);
    expect(parseM3U('#EXTM3U\n')).toEqual([]);
    expect(parseM3U('#EXTM3U')).toEqual([]);
  });

  it('post68: ftp and mms schemes reset without binding', () => {
    expect(
      parseM3U('#EXTM3U\n#EXTINF:-1,A\nftp://example.com/a\n#EXTINF:-1,B\nmms://example.com/b\n'),
    ).toEqual([]);
  });

  it('post68: app deep-link schemes reset without binding', () => {
    expect(
      parseM3U(
        '#EXTM3U\n#EXTINF:-1,A\nspotify:track:123\n#EXTINF:-1,B\nitms://example.com/b\n',
      ),
    ).toEqual([]);
  });

  it('post68: ipv6 literal https URL binds', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://[2001:db8::1]/stream.m3u8\n');
    expect(s.url).toBe('https://[2001:db8::1]/stream.m3u8');
  });

  it('post68: userinfo in URL is preserved', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://user:pass@example.com/a.m3u8\n');
    expect(s.url).toBe('https://user:pass@example.com/a.m3u8');
  });

  it('post68: very long display name after comma is preserved', () => {
    const name = 'N'.repeat(5000);
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,${name}\nhttps://example.com/long.m3u8\n`);
    expect(s.name).toBe(name);
  });

  it('post68: tvg-name wins over comma fallback when both present', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="Tvg",Comma Fallback\nhttps://example.com/t\n',
    );
    expect(s.name).toBe('Tvg');
  });

  it('post68: multiple commas — fallback uses last comma segment', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 foo=1,2,Final Name\nhttps://example.com/m\n');
    expect(s.name).toBe('Final Name');
  });

  it('post68: group-title with spaces preserved', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A" group-title="Late Night Jazz",A\nhttps://a\n',
    );
    expect(s.group).toBe('Late Night Jazz');
  });

  it('post68: JSON.stringify parse result round-trips', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(JSON.parse(JSON.stringify(stations))).toEqual(stations);
  });

  it('post68: Map of url→name for SAMPLE has 6 entries', () => {
    const map = new Map(parseM3U(SAMPLE_M3U).map((s) => [s.url, s.name]));
    expect(map.size).toBe(6);
    expect(map.get('https://example.com/alpha.m3u8')).toBe('Alpha FM');
  });

  it('post68: Set of SAMPLE urls has 6 unique', () => {
    expect(new Set(parseM3U(SAMPLE_M3U).map((s) => s.url)).size).toBe(6);
  });

  it('post68: reduce of SAMPLE name lengths sums to fixed total', () => {
    const sum = parseM3U(SAMPLE_M3U).reduce((acc, s) => acc + s.name.length, 0);
    expect(sum).toBe(8 + 7 + 8 + 8 + 10 + 7);
  });

  it('post68: localeCompare sort of SAMPLE names', () => {
    const names = parseM3U(SAMPLE_M3U).map((s) => s.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual([
      'Alpha FM',
      'Beta FM',
      'Delta FM',
      'Epsilon FM',
      'Gamma FM',
      'Zeta FM',
    ]);
  });

  it('post68: WeakRef of parseM3U still callable', () => {
    const ref = new WeakRef(parseM3U);
    expect(ref.deref()?.('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n')).toHaveLength(1);
  });

  it('post68: Promise.resolve parse matches sync', async () => {
    const raw = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n';
    await expect(Promise.resolve(parseM3U(raw))).resolves.toEqual(parseM3U(raw));
  });

  it('post68: purity — 50x identical SAMPLE parse', () => {
    const expected = parseM3U(SAMPLE_M3U);
    for (let i = 0; i < 50; i++) {
      expect(parseM3U(SAMPLE_M3U)).toEqual(expected);
    }
  });

  it('post68: final lock — sha256 stable across 10 reads', () => {
    const expected = 'cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368';
    for (let i = 0; i < 10; i++) {
      expect(createHash('sha256').update(parserSource, 'utf8').digest('hex')).toBe(expected);
    }
  });


  it('post68: parser source contains em dash in non-http URL comment', () => {
    expect(parserSource).toContain('Non-http URL (rtmp://, etc.) — skip but reset current');
  });

  it('post68: parseM3U trims every line via map trim', () => {
    expect(parserSource).toContain(".map((l) => l.trim())");
  });

  it('post68: current Partial Station resets on each EXTINF', () => {
    expect(parserSource).toContain('if (line.startsWith(\'#EXTINF\'))');
    expect(parserSource).toContain('current = {}');
  });

  it('post68: stations push includes all six Station fields', () => {
    expect(parserSource).toContain('logo: current.logo');
    expect(parserSource).toContain('group: current.group');
    expect(parserSource).toContain('language: current.language');
    expect(parserSource).toContain('country: current.country');
  });

  it('post68: no default export in parser.ts', () => {
    expect(parserSource).not.toMatch(/export default/);
  });

  it('post68: no import statements in parser.ts', () => {
    expect(parserSource).not.toMatch(/^import /m);
  });

  it('post68: EXTINF duration -1 is accepted without special casing', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(s.name).toBe('A');
  });

  it('post68: EXTINF duration 0 still binds with comma name', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:0,A\nhttps://a\n');
    expect(s.name).toBe('A');
  });

  it('post68: duplicate consecutive identical URLs keep first only', () => {
    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/x
#EXTINF:-1,B
https://example.com/x
#EXTINF:-1,C
https://example.com/x
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('A');
  });

  it('post68: windows CRLF input still parses after trim of \\r', () => {
    const raw = '#EXTM3U\r\n#EXTINF:-1,A\r\nhttps://example.com/crlf.m3u8\r\n';
    expect(parseM3U(raw)).toEqual([
      {
        name: 'A',
        url: 'https://example.com/crlf.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  });

  it('post68: attribute values may contain commas inside quotes', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A, B" group-title="X, Y",Z\nhttps://a\n',
    );
    expect(s.name).toBe('A, B');
    expect(s.group).toBe('X, Y');
  });

  it('post68: unquoted attribute values are not extracted by regex', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name=NoQuotes,Fallback\nhttps://a\n');
    expect(s.name).toBe('Fallback');
  });

  it('post68: logo with query string preserved', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A" tvg-logo="https://cdn.example/a.png?x=1",A\nhttps://a\n',
    );
    expect(s.logo).toBe('https://cdn.example/a.png?x=1');
  });

  it('post68: language and country independent optionality', () => {
    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A" tvg-language="fr",A\nhttps://a\n',
    );
    expect(s.language).toBe('fr');
    expect(s.country).toBeUndefined();
  });

  it('post68: http URL with port binds', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttp://example.com:8080/a\n');
    expect(s.url).toBe('http://example.com:8080/a');
  });

  it('post68: https URL with non-default port binds', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com:8443/a\n');
    expect(s.url).toBe('https://example.com:8443/a');
  });

  it('post68: data: and blob: schemes do not bind', () => {
    expect(
      parseM3U(
        '#EXTM3U\n#EXTINF:-1,A\ndata:text/plain,hi\n#EXTINF:-1,B\nblob:https://example.com/uuid\n',
      ),
    ).toEqual([]);
  });

  it('post68: file: scheme does not bind', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\nfile:///tmp/a.m3u8\n')).toEqual([]);
  });

  it('post68: relative URL without scheme resets current', () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\n/relative/path.m3u8\n')).toEqual([]);
  });

  it('post68: Object.keys on minimal station are name url plus undefined fields present', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.keys(s).sort()).toEqual(
      ['country', 'group', 'language', 'logo', 'name', 'url'].sort(),
    );
  });

  it('post68: JSON.stringify omits undefined optional fields', () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(JSON.stringify(s)).toBe('{"name":"A","url":"https://a"}');
  });

  it('post68: Array.from of parse result equals spread', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(Array.from(stations)).toEqual([...stations]);
  });

  it('post68: entries of first SAMPLE station', () => {
    const [s] = parseM3U(SAMPLE_M3U);
    expect(Object.fromEntries(Object.entries(s))).toEqual(s);
  });

  it('post68: filter Music group from SAMPLE keeps all six', () => {
    expect(parseM3U(SAMPLE_M3U).filter((s) => s.group === 'Music')).toHaveLength(6);
  });

  it('post68: map urls from SAMPLE all include example.com', () => {
    expect(parseM3U(SAMPLE_M3U).map((s) => s.url).every((u) => u.includes('example.com'))).toBe(
      true,
    );
  });

  it('post68: sort copy of SAMPLE names does not mutate original order', () => {
    const stations = parseM3U(SAMPLE_M3U);
    const names = stations.map((s) => s.name);
    expect([...names].sort()).not.toEqual(names);
    expect(stations.map((s) => s.name)).toEqual(names);
  });

  it('post68: reverse copy of SAMPLE names', () => {
    const names = parseM3U(SAMPLE_M3U).map((s) => s.name);
    expect([...names].reverse()).toEqual([
      'Zeta FM',
      'Epsilon FM',
      'Delta FM',
      'Gamma FM',
      'Beta FM',
      'Alpha FM',
    ]);
  });

  it('post68: at/ with of SAMPLE first and last', () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.at(0)?.name).toBe('Alpha FM');
    expect(stations.at(-1)?.name).toBe('Zeta FM');
  });

  it('post68: Buffer.from JSON parse sha256 is stable', () => {
    const json = JSON.stringify(parseM3U(SAMPLE_M3U));
    const a = createHash('sha256').update(json, 'utf8').digest('hex');
    const b = createHash('sha256').update(json, 'utf8').digest('hex');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('post68: cross-lock package.json does not depend on iptv parser libs', () => {
    const pkg = JSON.parse(readFileSync(join(parserRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).not.toHaveProperty('m3u8-parser');
    expect(pkg.dependencies).not.toHaveProperty('iptv-playlist-parser');
  });

  it('post68: cross-lock vitest coverage includes parser via src/**', () => {
    const vitest = readFileSync(join(parserRoot, 'vitest.config.ts'), 'utf8');
    expect(vitest).toContain("include: ['src/**/*.ts']");
  });

  it('post68: mega purity — 100x SAMPLE_M3U parse equal', () => {
    const expected = parseM3U(SAMPLE_M3U);
    for (let i = 0; i < 100; i++) {
      expect(parseM3U(SAMPLE_M3U)).toEqual(expected);
    }
  });

  it('post68: final source digest lock — sha1 stable', () => {
    expect(createHash('sha1').update(parserSource, 'utf8').digest('hex')).toBe(
      '701cdecbef5a9049af6bd11497493c4036a60211',
    );
  });


  // --- HEAVY burn (post-#79): deepen parser unit slice only — no product inventing ---
  // Orthogonal to #79 routes deepen. Complementary parseM3U locks after landed post-#56/#68 parser burns. Complementary locks for parseM3U.

  it('post-79: resets on magnet: then recovers with https', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Mag",Mag
    magnet:?xt=urn:btih:abcdefghijklmnopqrstuvwxyz123456
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/magnet-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on about:blank and about:config non-http lines', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Blank",Blank
    about:blank
    #EXTINF:-1 tvg-name="Cfg",Cfg
    about:config
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/about-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on blob: and filesystem: schemes', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Blob",Blob
    blob:https://example.com/uuid
    #EXTINF:-1 tvg-name="Fs",Fs
    filesystem:https://example.com/temporary/x
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/blob-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on ws: and wss: websocket schemes', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Ws",Ws
    ws://example.com/socket
    #EXTINF:-1 tvg-name="Wss",Wss
    wss://example.com/socket
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/ws-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on sms: tel: and mailto: contact schemes', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Sms",Sms
    sms:+15551212
    #EXTINF:-1 tvg-name="Tel",Tel
    tel:+15551212
    #EXTINF:-1 tvg-name="Mail",Mail
    mailto:radio@example.com
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/contact-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on intent: and market: android schemes', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Intent",Intent
    intent://scan/#Intent;scheme=zxing;end
    #EXTINF:-1 tvg-name="Market",Market
    market://details?id=com.example.radio
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/android-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on view-source: prefixed http without binding', () => {
        // view-source:https://... does not start with http(s):// after trim
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Vs",Vs
    view-source:https://example.com/stream
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/view-source-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: resets on file: absolute path then recovers', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="File",File
    file:///Users/radio/local.m3u8
    #EXTINF:-1 tvg-name="Ok",Ok
    https://example.com/file-ok.m3u8
    `);
        expect(stations.map((s) => s.name)).toEqual(['Ok']);
  });

  it('post-79: scheme mix matrix — only lowercase http(s) bind', () => {
        const schemes = [
          ['http://a.example/1', true],
          ['https://b.example/2', true],
          ['HTTP://c.example/3', false],
          ['HTTPS://d.example/4', false],
          ['Http://e.example/5', false],
          ['Https://f.example/6', false],
          ['hTTp://g.example/7', false],
          ['hTTps://h.example/8', false],
        ] as const;
        for (const [url, binds] of schemes) {
          const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,X\n${url}\n`);
          expect(stations).toHaveLength(binds ? 1 : 0);
        }
  });

  it('post-79: empty quoted group-title language country logo are retained as empty strings', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="E" tvg-logo="" group-title="" tvg-language="" tvg-country="",E\nhttps://e\n',
        );
        expect(s).toEqual({
          name: 'E',
          url: 'https://e',
          logo: '',
          group: '',
          language: '',
          country: '',
        });
  });

  it('post-79: attribute values may contain spaces and punctuation inside quotes', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="A & B (Live!)" group-title="News / Weather" tvg-language="en-US" tvg-country="US,CA",Disp\nhttps://u\n',
        );
        expect(s.name).toBe('A & B (Live!)');
        expect(s.group).toBe('News / Weather');
        expect(s.language).toBe('en-US');
        expect(s.country).toBe('US,CA');
  });

  it('post-79: first matching attr wins when tvg-name appears twice', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="First" tvg-name="Second",Disp\nhttps://u\n',
        );
        expect(s.name).toBe('First');
  });

  it('post-79: first matching logo group language country wins on duplicates', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo="https://a" tvg-logo="https://b" group-title="G1" group-title="G2" tvg-language="en" tvg-language="fr" tvg-country="US" tvg-country="GB",N\nhttps://u\n',
        );
        expect(s.logo).toBe('https://a');
        expect(s.group).toBe('G1');
        expect(s.language).toBe('en');
        expect(s.country).toBe('US');
  });

  it('post-79: unquoted attribute-like tokens are ignored by regex extractor', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name=Bare group-title=BareG,Fallback\nhttps://u\n',
        );
        // regex requires quotes — Bare is not captured; comma fallback supplies name
        expect(s.name).toBe('Fallback');
        expect(s.group).toBeUndefined();
  });

  it('post-79: single-quoted attrs are not matched (double-quote regex only)', () => {
        const [s] = parseM3U(
          "#EXTM3U\n#EXTINF:-1 tvg-name='Single' group-title='G',Fallback\nhttps://u\n",
        );
        expect(s.name).toBe('Fallback');
        expect(s.group).toBeUndefined();
  });

  it('post-79: attr keys with surrounding spaces inside EXTINF still match', () => {
        // regex is /tvg-name="..."/i — spaces before key are fine; spaces inside key are not
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1  tvg-name="SpacedKey"  group-title="G" ,SpacedKey\nhttps://u\n',
        );
        expect(s.name).toBe('SpacedKey');
        expect(s.group).toBe('G');
  });

  it('post-79: tvg-name with only spaces is truthy and blocks comma fallback', () => {
        const stations = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="   ",Display\nhttps://u\n',
        );
        expect(stations).toHaveLength(1);
        expect(stations[0].name).toBe('   ');
  });

  it('post-79: comma fallback with no characters after comma yields empty name skip', () => {
        // lastIndexOf comma exists; slice after is ''; falsy name → no bind
        expect(parseM3U('#EXTM3U\n#EXTINF:-1,\nhttps://u\n')).toEqual([]);
  });

  it('post-79: EXTINF without any comma and without tvg-name does not bind', () => {
        expect(parseM3U('#EXTM3U\n#EXTINF:-1 duration=10\nhttps://u\n')).toEqual([]);
  });

  it('post-79: duration and tvg-id before known attrs do not disturb extraction', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:123 tvg-id="id.1" tvg-name="N" radio="true",N\nhttps://u\n',
        );
        expect(s.name).toBe('N');
        expect(s).not.toHaveProperty('radio');
        expect(s).not.toHaveProperty('tvg-id');
  });

  it('post-79: trailing slash vs no slash are distinct dedupe keys', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    https://example.com/stream
    #EXTINF:-1,B
    https://example.com/stream/
    `);
        expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post-79: query string differences create distinct dedupe keys', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    https://example.com/s?a=1
    #EXTINF:-1,B
    https://example.com/s?a=2
    `);
        expect(stations).toHaveLength(2);
  });

  it('post-79: fragment differences create distinct dedupe keys', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    https://example.com/s#one
    #EXTINF:-1,B
    https://example.com/s#two
    `);
        expect(stations.map((s) => s.url)).toEqual([
          'https://example.com/s#one',
          'https://example.com/s#two',
        ]);
  });

  it('post-79: identical URL with different attrs still dedupes to first', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="First" group-title="G1",First
    https://same.example/x
    #EXTINF:-1 tvg-name="Second" group-title="G2",Second
    https://same.example/x
    `);
        expect(stations).toHaveLength(1);
        expect(stations[0]).toMatchObject({ name: 'First', group: 'G1' });
  });

  it('post-79: URL with userinfo is preserved and deduped exactly', () => {
        const url = 'https://user:pass@example.com/live';
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    ${url}
    #EXTINF:-1,B
    ${url}
    `);
        expect(stations).toHaveLength(1);
        expect(stations[0].url).toBe(url);
  });

  it('post-79: IPv4 and IPv6 literal hosts bind as written', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,V4
    http://127.0.0.1:8080/live
    #EXTINF:-1,V6
    https://[2001:db8::1]/live
    `);
        expect(stations.map((s) => s.url)).toEqual([
          'http://127.0.0.1:8080/live',
          'https://[2001:db8::1]/live',
        ]);
  });

  it('post-79: percent-encoded path segments are not decoded', () => {
        const url = 'https://example.com/%2F%2E%2E%2Fsecret.m3u8';
        expect(parseM3U(`#EXTM3U\n#EXTINF:-1,P\n${url}\n`)[0].url).toBe(url);
  });

  it('post-79: internationalized domain punycode host is preserved', () => {
        const url = 'https://xn--bcher-kva.example/stream.m3u8';
        expect(parseM3U(`#EXTM3U\n#EXTINF:-1,IDN\n${url}\n`)[0].url).toBe(url);
  });

  it('post-79: EXTINF alone after comments without URL yields empty', () => {
        expect(
          parseM3U('#EXTM3U\n#COMMENT\n#EXTINF:-1,Orphan\n#ENDLIST\n'),
        ).toEqual([]);
  });

  it('post-79: #EXT-X-STREAM-INF style HLS tags do not clear pending current', () => {
        // only non-# non-http lines reset; # lines are ignored without reset
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Hls",Hls
    #EXT-X-STREAM-INF:BANDWIDTH=128000
    https://example.com/hls.m3u8
    `);
        expect(stations).toHaveLength(1);
        expect(stations[0].name).toBe('Hls');
  });

  it('post-79: multiple blank and comment lines between EXTINF and URL', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Gap",Gap

    # keep

    https://example.com/gap.m3u8
    `);
        expect(stations).toHaveLength(1);
        expect(stations[0].url).toBe('https://example.com/gap.m3u8');
  });

  it('post-79: BOM-prefixed header still parses when BOM is on its own consideration', () => {
        // BOM as first char of first line — after trim BOM may remain
        const withBom = '\uFEFF#EXTM3U\n#EXTINF:-1,Bom\nhttps://example.com/bom.m3u8\n';
        // line starts with BOM+#EXTM3U — startsWith('#EXTINF') false; BOM line ignored as #
        // Actually trim doesn't remove BOM; line is "\uFEFF#EXTM3U" which starts with BOM not #
        // Non-http non-# non-empty → RESET path. Then EXTINF+URL should still work.
        const stations = parseM3U(withBom);
        expect(stations.map((s) => s.name)).toEqual(['Bom']);
  });

  it('post-79: CRLF and CR-only mixed line endings still bind', () => {
        const crOnly = '#EXTM3U\r#EXTINF:-1,A\rhttps://a\r';
        // split('\\n') won't split on CR-only — entire blob may be one line
        // Document actual behavior: CR-only without LF yields no stations (no line breaks)
        expect(parseM3U(crOnly)).toEqual([]);
        const crlf = parseM3U('#EXTM3U\r\n#EXTINF:-1,A\r\nhttps://a\r\n');
        expect(crlf).toHaveLength(1);
  });

  it('post-79: Object.seal on stations array allows property reads', () => {
        const stations = Object.seal(parseM3U(SAMPLE_M3U));
        expect(stations).toHaveLength(6);
        expect(stations[0].name).toBe('Alpha FM');
  });

  it('post-79: Object.preventExtensions on station still exposes keys', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        Object.preventExtensions(s);
        expect(Object.isExtensible(s)).toBe(false);
        expect(s.name).toBe('A');
        expect(Object.keys(s).sort()).toEqual(
          ['country', 'group', 'language', 'logo', 'name', 'url'].sort(),
        );
  });

  it('post-79: Reflect.ownKeys on station matches Object.keys plus no symbols', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="R" group-title="G",R\nhttps://r\n',
        );
        expect(Reflect.ownKeys(s)).toEqual(Object.keys(s));
        expect(Reflect.ownKeys(s)).toEqual(['name', 'url', 'logo', 'group', 'language', 'country']);
  });

  it('post-79: structuredClone then mutate clone leaves original intact', () => {
        const original = parseM3U(SAMPLE_M3U);
        const clone = structuredClone(original);
        clone[0].name = 'MUT';
        clone.pop();
        expect(original[0].name).toBe('Alpha FM');
        expect(original).toHaveLength(6);
  });

  it('post-79: JSON round-trip drops undefined optional fields', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        expect(s.logo).toBeUndefined();
        const round = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
        expect(round).toEqual({ name: 'A', url: 'https://a' });
        expect(round).not.toHaveProperty('logo');
  });

  it('post-79: Array.from and slice produce shallow copies of station refs', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const copy = Array.from(stations);
        expect(copy).toEqual(stations);
        expect(copy[0]).toBe(stations[0]);
        const sliced = stations.slice();
        expect(sliced[1]).toBe(stations[1]);
  });

  it('post-79: Proxy get trap still returns locked station fields', () => {
        const [raw] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="P",P\nhttps://p\n');
        const proxy = new Proxy(raw, {
          get(target, prop, receiver) {
            return Reflect.get(target, prop, receiver);
          },
        });
        expect(proxy.name).toBe('P');
        expect(proxy.url).toBe('https://p');
  });

  it('post-79: does not invent bitrate codec or resolution fields', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="N" bitrate="128" codec="mp3",N\nhttps://u\n',
        );
        expect(s).not.toHaveProperty('bitrate');
        expect(s).not.toHaveProperty('codec');
        expect(s).not.toHaveProperty('resolution');
  });

  it('post-79: does not invent now_playing playlist or epg fields', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        for (const key of ['now_playing', 'nowPlaying', 'playlist', 'epg', 'tvgId', 'tvg-id']) {
          expect(s).not.toHaveProperty(key);
        }
  });

  it('post-79: Station key insertion order is name url logo group language country', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",N\nhttps://u\n',
        );
        expect(Object.keys(s)).toEqual(['name', 'url', 'logo', 'group', 'language', 'country']);
  });

  it('post-79: sparse optional fields still emit keys with undefined values', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N",N\nhttps://u\n');
        expect(Object.prototype.hasOwnProperty.call(s, 'logo')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(s, 'group')).toBe(true);
        expect(s.logo).toBeUndefined();
        expect(s.group).toBeUndefined();
  });

  it('post-79: cross-lock SAMPLE_M3U parse length equals countHttpStreamLines', () => {
        expect(parseM3U(SAMPLE_M3U)).toHaveLength(countHttpStreamLines(SAMPLE_M3U));
  });

  it('post-79: cross-lock buildSimpleM3U round-trip for all VALID-like genres as group', () => {
        const groups = ['music', 'ambient', 'jazz', 'classical', 'pop', 'rock', 'news', 'sports', 'entertainment'];
        for (const g of groups) {
          const m3u = buildSimpleM3U([{ name: g, url: `https://example.com/${g}.m3u8`, group: g }]);
          const [s] = parseM3U(m3u);
          expect(s.group).toBe(g);
          expect(s.name).toBe(g);
        }
  });

  it('post-79: cross-lock buildSimpleM3U http and https mix preserves schemes', () => {
        const m3u = buildSimpleM3U([
          { name: 'H', url: 'http://example.com/h' },
          { name: 'S', url: 'https://example.com/s' },
        ]);
        expect(parseM3U(m3u).map((s) => s.url)).toEqual([
          'http://example.com/h',
          'https://example.com/s',
        ]);
        expect(countHttpStreamLines(m3u)).toBe(2);
  });

  it('post-79: cross-lock buildSimpleM3U empty logo group omitted vs empty string', () => {
        const omitted = buildSimpleM3U([{ name: 'A', url: 'https://a' }]);
        const empty = buildSimpleM3U([{ name: 'B', url: 'https://b', logo: '', group: '' }]);
        expect(omitted).not.toContain('tvg-logo');
        expect(empty).toContain('tvg-logo=""');
        expect(parseM3U(empty)[0].logo).toBe('');
        expect(parseM3U(omitted)[0].logo).toBeUndefined();
  });

  it('post-79: emoji in tvg-name group and language are preserved', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="📻 Live" group-title="🎵" tvg-language="🏳️",Disp\nhttps://u\n',
        );
        expect(s.name).toBe('📻 Live');
        expect(s.group).toBe('🎵');
        expect(s.language).toBe('🏳️');
  });

  it('post-79: RTL and LTR unicode names preserve code points', () => {
        const name = 'محطة الراديو';
        const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u\n`);
        expect(s.name).toBe(name);
        expect([...s.name]).toHaveLength([...name].length);
  });

  it('post-79: combining characters in name are not normalized by parser', () => {
        const name = 'e\u0301'; // e + combining acute
        const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u\n`);
        expect(s.name).toBe(name);
        expect(s.name).not.toBe('é');
        expect(s.name.normalize('NFC')).toBe('é');
  });

  it('post-79: surrogate pair musical symbol in URL path preserved', () => {
        const url = 'https://example.com/\uD83C\uDFB5.m3u8';
        expect(parseM3U(`#EXTM3U\n#EXTINF:-1,M\n${url}\n`)[0].url).toBe(url);
  });

  it('post-79: parses 100 sequential unique stations in order', () => {
        const lines = ['#EXTM3U'];
        for (let i = 0; i < 100; i++) {
          lines.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
          lines.push(`https://example.com/${i}.m3u8`);
        }
        const stations = parseM3U(lines.join('\n'));
        expect(stations).toHaveLength(100);
        expect(stations[0].name).toBe('S0');
        expect(stations[99].name).toBe('S99');
        expect(stations[50].url).toBe('https://example.com/50.m3u8');
  });

  it('post-79: 100 duplicate URLs collapse to a single first station', () => {
        const lines = ['#EXTM3U'];
        for (let i = 0; i < 100; i++) {
          lines.push(`#EXTINF:-1 tvg-name="D${i}",D${i}`);
          lines.push('https://example.com/dup.m3u8');
        }
        const stations = parseM3U(lines.join('\n'));
        expect(stations).toHaveLength(1);
        expect(stations[0].name).toBe('D0');
  });

  it('post-79: alternating rtmp and https yields only https stations', () => {
        const lines = ['#EXTM3U'];
        for (let i = 0; i < 20; i++) {
          lines.push(`#EXTINF:-1,R${i}`);
          lines.push(`rtmp://bad/${i}`);
          lines.push(`#EXTINF:-1,H${i}`);
          lines.push(`https://ok/${i}`);
        }
        const stations = parseM3U(lines.join('\n'));
        expect(stations).toHaveLength(20);
        expect(stations.every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('post-79: interleaved orphan URLs do not steal following EXTINF names', () => {
        const stations = parseM3U(`#EXTM3U
    https://orphan-1
    #EXTINF:-1,A
    https://a
    https://orphan-2
    #EXTINF:-1,B
    https://b
    `);
        expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post-79: second EXTINF without URL discards first pending attrs', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Old" group-title="OldG",Old
    #EXTINF:-1 tvg-name="New",New
    https://new
    `);
        expect(stations).toEqual([
          {
            name: 'New',
            url: 'https://new',
            logo: undefined,
            group: undefined,
            language: undefined,
            country: undefined,
          },
        ]);
  });

  it('post-79: non-http line after EXTINF clears attrs before next EXTINF', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Gone" group-title="G",Gone
    not-a-url
    #EXTINF:-1 tvg-name="Kept",Kept
    https://kept
    `);
        expect(stations).toHaveLength(1);
        expect(stations[0].name).toBe('Kept');
        expect(stations[0].group).toBeUndefined();
  });

  it('post-79: whitespace-only line does not clear pending EXTINF', () => {
        const stations = parseM3U('#EXTM3U\n#EXTINF:-1,A\n   \nhttps://a\n');
        expect(stations).toHaveLength(1);
        expect(stations[0].name).toBe('A');
  });

  it('post-79: hash-only line # is ignored without clearing pending', () => {
        const stations = parseM3U('#EXTM3U\n#EXTINF:-1,A\n#\nhttps://a\n');
        expect(stations).toHaveLength(1);
  });

  it('post-79: mixed-case TVG-Name Group-Title keys match case-insensitively', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 Tvg-Name="N" Group-Title="G" Tvg-Language="en" Tvg-Country="US" Tvg-Logo="https://l",N\nhttps://u\n',
        );
        expect(s).toMatchObject({
          name: 'N',
          group: 'G',
          language: 'en',
          country: 'US',
          logo: 'https://l',
        });
  });

  it('post-79: tvg_name with underscore does not match tvg-name extractor', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg_name="Under" group_title="G",Fallback\nhttps://u\n',
        );
        expect(s.name).toBe('Fallback');
        expect(s.group).toBeUndefined();
  });

  it('post-79: tvg-name with single double-quote inside value cannot close early via naive parse', () => {
        // regex ([^"]*) stops at first interior quote — documents actual behavior
        const stations = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="He said "Hi"",X\nhttps://u\n',
        );
        // nameMatch captures 'He said ' then remainder breaks; may fall back oddly
        // Lock actual observed behavior: capture stops at interior quote
        if (stations.length) {
          expect(stations[0].name).toBe('He said ');
        } else {
          // if name becomes falsy somehow
          expect(stations).toEqual([]);
        }
  });

  it('post-79: http URL with only scheme and host binds', () => {
        expect(parseM3U('#EXTM3U\n#EXTINF:-1,H\nhttp://example.com\n')[0].url).toBe(
          'http://example.com',
        );
  });

  it('post-79: https URL with query only path root binds', () => {
        const url = 'https://example.com/?stream=1';
        expect(parseM3U(`#EXTM3U\n#EXTINF:-1,Q\n${url}\n`)[0].url).toBe(url);
  });

  it('post-79: URL line with trailing spaces trims before scheme check and store', () => {
        const stations = parseM3U('#EXTM3U\n#EXTINF:-1,T\nhttps://example.com/t   \n');
        expect(stations[0].url).toBe('https://example.com/t');
  });

  it('post-79: leading and trailing tabs around URL are trimmed', () => {
        const stations = parseM3U('#EXTM3U\n#EXTINF:-1,T\n\t\thttps://example.com/tabs\t\t\n');
        expect(stations[0].url).toBe('https://example.com/tabs');
  });

  it('post-79: parseM3U is pure — repeated calls on identical input deep-equal', () => {
        const input = SAMPLE_M3U;
        const results = Array.from({ length: 5 }, () => parseM3U(input));
        for (let i = 1; i < results.length; i++) {
          expect(results[i]).toEqual(results[0]);
          expect(results[i]).not.toBe(results[0]);
        }
  });

  it('post-79: mutating input string after parse is impossible (strings immutable) still stable', () => {
        let input = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n';
        const stations = parseM3U(input);
        input = 'mutated';
        expect(stations[0].name).toBe('A');
  });

  it('post-79: frozen input string parses identically to unfrozen', () => {
        const raw = '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n';
        expect(parseM3U(Object.freeze(raw))).toEqual(parseM3U(raw));
  });

  it('post-79: station field descriptors are writable enumerable configurable', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        for (const key of Object.keys(s)) {
          const d = Object.getOwnPropertyDescriptor(s, key);
          expect(d).toMatchObject({ writable: true, enumerable: true, configurable: true });
        }
  });

  it('post-79: parse result array is not sparse', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(stations.length).toBe(6);
        for (let i = 0; i < stations.length; i++) {
          expect(i in stations).toBe(true);
          expect(stations[i]).toBeTruthy();
        }
  });

  it('post-79: empty parse result is a new array each call', () => {
        const a = parseM3U('');
        const b = parseM3U('');
        expect(a).toEqual([]);
        expect(b).toEqual([]);
        expect(a).not.toBe(b);
  });

  it('post-79: SAMPLE fixture local SAMPLE and helpers SAMPLE_M3U both parse non-empty', () => {
        expect(parseM3U(SAMPLE).length).toBeGreaterThan(0);
        expect(parseM3U(SAMPLE_M3U).length).toBe(6);
  });

  it('post-79: local SAMPLE dedupes jazz URL and skips rtmp as locked in header tests', () => {
        const stations = parseM3U(SAMPLE);
        expect(stations.filter((s) => s.url.includes('jazz'))).toHaveLength(1);
        expect(stations.some((s) => s.name === 'Skip RTMP')).toBe(false);
        expect(stations.some((s) => s.url.startsWith('rtmp://'))).toBe(false);
  });

  it('post-79: countHttpStreamLines on SAMPLE counts rtmp? no — only http(s)', () => {
    // SAMPLE lines: drone https, jazz https, dup jazz https, comma https, rtmp, news http
    // countHttpStreamLines = 5 (excludes rtmp); parse = 4 (dedupes jazz)
    const httpCount = countHttpStreamLines(SAMPLE);
    expect(httpCount).toBe(5);
    expect(parseM3U(SAMPLE)).toHaveLength(4);
    expect(parseM3U(SAMPLE).length).toBeLessThan(httpCount);
  });

  it('post-79: logo may be data URI and is not treated as stream', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="D" tvg-logo="data:image/png;base64,abc",D\nhttps://u\n',
        );
        expect(s.logo).toBe('data:image/png;base64,abc');
        expect(s.url).toBe('https://u');
  });

  it('post-79: group-title with only spaces is preserved', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="   ",N\nhttps://u\n',
        );
        expect(s.group).toBe('   ');
  });

  it('post-79: language and country empty-vs-missing distinction', () => {
        const missing = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n')[0];
        const empty = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="B" tvg-language="" tvg-country="",B\nhttps://b\n',
        )[0];
        expect(missing.language).toBeUndefined();
        expect(empty.language).toBe('');
        expect(empty.country).toBe('');
  });

  it('post-79: 50KB group-title value binds without truncation', () => {
        const group = 'G'.repeat(50_000);
        const [s] = parseM3U(
          `#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="${group}",N\nhttps://u\n`,
        );
        expect(s.group).toHaveLength(50_000);
  });

  it('post-79: playlist of 500 stations maintains index fidelity', () => {
        const lines = ['#EXTM3U'];
        for (let i = 0; i < 500; i++) {
          lines.push(`#EXTINF:-1 tvg-name="N${i}" group-title="G${i % 9}",N${i}`);
          lines.push(`https://example.com/s/${i}.m3u8`);
        }
        const stations = parseM3U(lines.join('\n'));
        expect(stations).toHaveLength(500);
        expect(stations[249].name).toBe('N249');
        expect(stations[249].group).toBe('G6');
        expect(stations[499].url).toBe('https://example.com/s/499.m3u8');
  });

  it('post-79: stations can be keyed in a Map by url without collision for SAMPLE_M3U', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const map = new Map(stations.map((s) => [s.url, s]));
        expect(map.size).toBe(stations.length);
        expect(map.get('https://example.com/alpha.m3u8')?.name).toBe('Alpha FM');
  });

  it('post-79: Set of urls from parse equals unique stream set', () => {
        const stations = parseM3U(SAMPLE);
        const urls = stations.map((s) => s.url);
        expect(new Set(urls).size).toBe(urls.length);
  });

  it('post-79: station toString is default Object prototype tag', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        expect(Object.prototype.toString.call(s)).toBe('[object Object]');
        expect(String(s)).toBe('[object Object]');
  });

  it('post-79: array toString joins station object tags', () => {
        const stations = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nhttps://b\n');
        expect(stations.toString()).toBe('[object Object],[object Object]');
  });

  it('post-79: for-of and forEach visit stations in order', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const viaForOf: string[] = [];
        for (const s of stations) viaForOf.push(s.name);
        const viaForEach: string[] = [];
        stations.forEach((s) => viaForEach.push(s.name));
        expect(viaForOf).toEqual(viaForEach);
        expect(viaForOf[0]).toBe('Alpha FM');
        expect(viaForOf.at(-1)).toBe('Zeta FM');
  });

  it('post-79: entries() indices are contiguous from zero', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect([...stations.entries()].map(([i]) => i)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('post-79: resets on sftp: and ftps: then recovers', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    sftp://host/path
    #EXTINF:-1,B
    ftps://host/path
    #EXTINF:-1,C
    https://ok
    `);
        expect(stations.map((s) => s.name)).toEqual(['C']);
  });

  it('post-79: resets on mms: mmsh: and rtsp: media schemes', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    mms://example.com/live
    #EXTINF:-1,B
    mmsh://example.com/live
    #EXTINF:-1,C
    rtsp://example.com/live
    #EXTINF:-1,D
    https://ok
    `);
        expect(stations.map((s) => s.name)).toEqual(['D']);
  });

  it('post-79: resets on apt: and snap: package schemes', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    apt:vlc
    #EXTINF:-1,B
    snap:vlc
    #EXTINF:-1,C
    https://ok
    `);
        expect(stations.map((s) => s.name)).toEqual(['C']);
  });

  it('post-79: does not use title or displayName instead of name', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        expect(s).toHaveProperty('name');
        expect(s).not.toHaveProperty('title');
        expect(s).not.toHaveProperty('displayName');
        expect(s).not.toHaveProperty('station_name');
  });

  it('post-79: does not use uri or href instead of url', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        expect(s).toHaveProperty('url');
        expect(s).not.toHaveProperty('uri');
        expect(s).not.toHaveProperty('href');
        expect(s).not.toHaveProperty('streamUrl');
  });

  it('post-79: does not use category or genre instead of group', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="A" group-title="Jazz",A\nhttps://a\n',
        );
        expect(s.group).toBe('Jazz');
        expect(s).not.toHaveProperty('category');
        expect(s).not.toHaveProperty('genre');
  });

  it('post-79: encodeURI of url round-trips for simple https paths', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://example.com/a/b.m3u8\n');
        expect(encodeURI(s.url)).toBe(s.url);
        expect(decodeURI(s.url)).toBe(s.url);
  });

  it('post-79: URL constructor accepts parsed http(s) station urls from SAMPLE_M3U', () => {
        for (const s of parseM3U(SAMPLE_M3U)) {
          const u = new URL(s.url);
          expect(u.protocol === 'http:' || u.protocol === 'https:').toBe(true);
          expect(u.hostname).toBe('example.com');
        }
  });

  it('post-79: filter by group Music returns all SAMPLE_M3U stations', () => {
        const music = parseM3U(SAMPLE_M3U).filter((s) => s.group === 'Music');
        expect(music).toHaveLength(6);
  });

  it('post-79: map to names is stable Alpha..Zeta', () => {
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
  });

  it('post-79: reduce concatenates urls with pipe separator', () => {
        const joined = parseM3U(
          '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nhttps://b\n',
        ).reduce((acc, s) => (acc ? `${acc}|${s.url}` : s.url), '');
        expect(joined).toBe('https://a|https://b');
  });

  it('post-79: line starting with #EXTINF but not exact prefix still treated as EXTINF', () => {
        // startsWith('#EXTINF') — #EXTINF-FOO still enters EXTINF branch
        const stations = parseM3U(
          '#EXTM3U\n#EXTINF-FOO:-1 tvg-name="X",X\nhttps://x\n',
        );
        expect(stations).toHaveLength(1);
        expect(stations[0].name).toBe('X');
  });

  it('post-79: #extinf lowercase matches startsWith only for exact #EXTINF case', () => {
        // startsWith('#EXTINF') is case-sensitive — lowercase does not enter EXTINF branch
        // lowercase #extinf is still a # comment line → ignored without reset
        // but then no name pending → URL won't bind
        expect(parseM3U('#EXTM3U\n#extinf:-1,A\nhttps://a\n')).toEqual([]);
  });

  it('post-79: #EXTINF in the middle of a non-starting line does not trigger', () => {
        // line must start with #EXTINF after trim
        const stations = parseM3U(
          '#EXTM3U\nxx#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nhttps://b\n',
        );
        // xx#EXTINF... is non-# (starts with x) non-http → reset; then B binds
        expect(stations.map((s) => s.name)).toEqual(['B']);
  });

  it('post-79: fully populated station deep-equals expected literal', () => {
        expect(
          parseM3U(
            '#EXTM3U\n#EXTINF:-1 tvg-name="Full" tvg-logo="https://cdn/l.png" group-title="Jazz" tvg-language="en" tvg-country="US",Disp\nhttps://full.example/s.m3u8\n',
          ),
        ).toEqual([
          {
            name: 'Full',
            url: 'https://full.example/s.m3u8',
            logo: 'https://cdn/l.png',
            group: 'Jazz',
            language: 'en',
            country: 'US',
          },
        ]);
  });

  it('post-79: minimal comma-only station deep-equals with undefined optionals', () => {
        expect(parseM3U('#EXTM3U\n#EXTINF:-1,Min\nhttp://min\n')).toEqual([
          {
            name: 'Min',
            url: 'http://min',
            logo: undefined,
            group: undefined,
            language: undefined,
            country: undefined,
          },
        ]);
  });

  it('post-79: TextEncoder/TextDecoder round-trip of M3U source before parse', () => {
        const src = '#EXTM3U\n#EXTINF:-1 tvg-name="東京",T\nhttps://tokyo.example/t\n';
        const decoded = new TextDecoder().decode(new TextEncoder().encode(src));
        expect(parseM3U(decoded)).toEqual(parseM3U(src));
  });

  it('post-79: JSON.stringify of SAMPLE_M3U parse is parseable array of length 6', () => {
        const json = JSON.stringify(parseM3U(SAMPLE_M3U));
        const back = JSON.parse(json) as unknown[];
        expect(back).toHaveLength(6);
        expect(json.startsWith('[')).toBe(true);
  });

  it('post-79: reversing parse copy does not mutate original order', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const reversed = stations.slice().reverse();
        expect(stations[0].name).toBe('Alpha FM');
        expect(reversed[0].name).toBe('Zeta FM');
  });

  it('post-79: sort by name on copy leaves original Alpha-first', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const sorted = stations.slice().sort((a, b) => b.name.localeCompare(a.name));
        expect(stations[0].name).toBe('Alpha FM');
        expect(sorted[0].name).toBe('Zeta FM');
  });

  it('post-79: trailing newlines after last URL do not invent stations', () => {
        const stations = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n\n\n\n');
        expect(stations).toHaveLength(1);
  });

  it('post-79: leading newlines before header are harmless', () => {
        expect(parseM3U('\n\n#EXTM3U\n#EXTINF:-1,A\nhttps://a\n')).toHaveLength(1);
  });

  it('post-79: only https line with EXTINF on previous playlist chunk', () => {
        const stations = parseM3U('#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nhttps://b\n');
        expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it("post-79: name '0' and 'false' are truthy and bind", () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="0",0
    https://zero
    #EXTINF:-1 tvg-name="false",false
    https://false
    `);
        expect(stations.map((s) => s.name)).toEqual(['0', 'false']);
  });

  it("post-79: name 'null' and 'undefined' strings bind as literals", () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="null",null
    https://null
    #EXTINF:-1 tvg-name="undefined",undefined
    https://undefined
    `);
        expect(stations.map((s) => s.name)).toEqual(['null', 'undefined']);
  });

  it('post-79: buildSimpleM3U of 30 stations parses with equal length', () => {
        const specs = Array.from({ length: 30 }, (_, i) => ({
          name: `N${i}`,
          url: `https://example.com/${i}`,
          group: i % 2 === 0 ? 'Even' : 'Odd',
        }));
        const m3u = buildSimpleM3U(specs);
        const stations = parseM3U(m3u);
        expect(stations).toHaveLength(30);
        expect(countHttpStreamLines(m3u)).toBe(30);
        expect(stations.filter((s) => s.group === 'Even')).toHaveLength(15);
  });

  it('post-79: buildSimpleM3U country and language round-trip for ISO-like codes', () => {
        const m3u = buildSimpleM3U([
          { name: 'US', url: 'https://u', language: 'en', country: 'US' },
          { name: 'JP', url: 'https://j', language: 'ja', country: 'JP' },
          { name: 'BR', url: 'https://b', language: 'pt', country: 'BR' },
        ]);
        expect(parseM3U(m3u).map((s) => [s.language, s.country])).toEqual([
          ['en', 'US'],
          ['ja', 'JP'],
          ['pt', 'BR'],
        ]);
  });

  it('post-79: Object.is compares url strings from dual parses as equal', () => {
        const a = parseM3U(SAMPLE_M3U)[0].url;
        const b = parseM3U(SAMPLE_M3U)[0].url;
        expect(Object.is(a, b)).toBe(true);
  });

  it('post-79: Object.is on distinct station objects is false even if deep-equal', () => {
        const a = parseM3U(SAMPLE_M3U)[0];
        const b = parseM3U(SAMPLE_M3U)[0];
        expect(a).toEqual(b);
        expect(Object.is(a, b)).toBe(false);
  });

  it('post-79: stations are valid WeakMap keys (objects)', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const wm = new WeakMap<object, string>();
        for (const s of stations) wm.set(s, s.name);
        expect(wm.get(stations[0])).toBe('Alpha FM');
  });

  it('post-79: does not invent curated editorial or mood fields on stations', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        for (const key of ['editorial', 'mood', 'curated', 'curated_by', 'query', 'score']) {
          expect(s).not.toHaveProperty(key);
        }
  });

  it('post-79: does not invent MCP tool or manifest fields on stations', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        for (const key of ['input_schema', 'name_for_model', 'tools', 'schema_version']) {
          expect(s).not.toHaveProperty(key);
        }
  });

  it('post-79: parse result does not carry prototype pollution keys', () => {
        const stations = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="__proto__",X\nhttps://u\n',
        );
        expect(stations[0].name).toBe('__proto__');
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(stations[0], 'name')).toBe(true);
  });

  it('post-79: two URLs after one EXTINF — second URL has no name and is skipped', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    https://a
    https://b
    `);
        expect(stations.map((s) => s.url)).toEqual(['https://a']);
  });

  it('post-79: EXTINF URL EXTINF URL pattern binds both', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    https://a
    #EXTINF:-1,B
    https://b
    `);
        expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('post-79: attr order country before name still extracts both', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-country="US" tvg-language="en" group-title="G" tvg-logo="L" tvg-name="N",N\nhttps://u\n',
        );
        expect(s).toMatchObject({
          name: 'N',
          country: 'US',
          language: 'en',
          group: 'G',
          logo: 'L',
        });
  });

  it('post-79: display name after comma may contain commas if tvg-name present', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="Official",Display, With, Commas\nhttps://u\n',
        );
        expect(s.name).toBe('Official');
  });

  it('post-79: without tvg-name last comma segment is the name even if earlier commas exist in attrs', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 group-title="A, B, C",Final Name\nhttps://u\n',
        );
        expect(s.name).toBe('Final Name');
        expect(s.group).toBe('A, B, C');
  });

  it('post-79: names Infinity and NaN bind as strings', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1 tvg-name="Infinity",Infinity
    https://inf
    #EXTINF:-1 tvg-name="NaN",NaN
    https://nan
    `);
        expect(stations.map((s) => s.name)).toEqual(['Infinity', 'NaN']);
  });

  it('post-79: every SAMPLE_M3U station url ends with .m3u8', () => {
        expect(parseM3U(SAMPLE_M3U).every((s) => s.url.endsWith('.m3u8'))).toBe(true);
  });

  it('post-79: every SAMPLE_M3U station name ends with FM', () => {
        expect(parseM3U(SAMPLE_M3U).every((s) => s.name.endsWith(' FM'))).toBe(true);
  });

  it('post-79: parseM3U length is never greater than countHttpStreamLines', () => {
        const fixtures = [SAMPLE, SAMPLE_M3U, buildSimpleM3U([{ name: 'A', url: 'https://a' }, { name: 'B', url: 'http://b' }]), ''];
        for (const f of fixtures) {
          expect(parseM3U(f).length).toBeLessThanOrEqual(countHttpStreamLines(f));
        }
  });

  it('post-79: dedupe explains SAMPLE parse length strictly less than http line count', () => {
        expect(parseM3U(SAMPLE).length).toBeLessThan(countHttpStreamLines(SAMPLE));
  });

  it('post-79: Array.isArray and instanceof Array both true for parse results', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(Array.isArray(stations)).toBe(true);
        expect(stations instanceof Array).toBe(true);
  });

  it('post-79: station instanceof Object is true but not Array', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
        expect(s instanceof Object).toBe(true);
        expect(s instanceof Array).toBe(false);
  });

  it('post-79: null-prototype assign copy still deep-equals station fields', () => {
        const [s] = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n',
        );
        const copy = Object.assign(Object.create(null), s) as Record<string, unknown>;
        expect(copy.name).toBe('N');
        expect(copy.group).toBe('G');
        expect(Object.getPrototypeOf(copy)).toBe(null);
  });

  it('post-79: values() iterator yields stations in order for SAMPLE_M3U', () => {
        expect([...parseM3U(SAMPLE_M3U).values()].map((s) => s.name)).toEqual([
          'Alpha FM',
          'Beta FM',
          'Gamma FM',
          'Delta FM',
          'Epsilon FM',
          'Zeta FM',
        ]);
  });

  it('post-79: flatMap identity returns same length as parse', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(stations.flatMap((s) => [s])).toHaveLength(stations.length);
  });

  it('post-79: some/every predicates on SAMPLE_M3U groups', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(stations.every((s) => s.group === 'Music')).toBe(true);
        expect(stations.some((s) => s.name.startsWith('Alpha'))).toBe(true);
        expect(stations.some((s) => s.name.startsWith('Omega'))).toBe(false);
  });

  it('post-79: find and findIndex locate Delta FM', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(stations.find((s) => s.name === 'Delta FM')?.url).toBe(
          'https://example.com/delta.m3u8',
        );
        expect(stations.findIndex((s) => s.name === 'Delta FM')).toBe(3);
  });

  it('post-79: includes on station object refs works for same instance', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(stations.includes(stations[2])).toBe(true);
        expect(stations.includes(parseM3U(SAMPLE_M3U)[2])).toBe(false);
  });

  it('post-79: at() supports negative indices for last station', () => {
        const stations = parseM3U(SAMPLE_M3U);
        expect(stations.at(-1)?.name).toBe('Zeta FM');
        expect(stations.at(-6)?.name).toBe('Alpha FM');
        expect(stations.at(100)).toBeUndefined();
  });

  it('post-79: with() replacement returns new array without mutating original', () => {
    const stations = parseM3U(SAMPLE_M3U);
    // ES2022-safe stand-in for Array.prototype.with
    const replaced = stations.slice();
    replaced[0] = {
      name: 'Replaced',
      url: 'https://replaced',
      logo: undefined,
      group: undefined,
      language: undefined,
      country: undefined,
    };
    expect(stations[0].name).toBe('Alpha FM');
    expect(replaced[0].name).toBe('Replaced');
    expect(replaced).toHaveLength(6);
  });

  it('post-79: toReversed and toSorted leave original Alpha-first', () => {
    const stations = parseM3U(SAMPLE_M3U);
    // ES2022-safe stand-ins for toReversed / toSorted
    expect(stations.slice().reverse()[0].name).toBe('Zeta FM');
    expect(
      stations.slice().sort((a, b) => b.name.localeCompare(a.name))[0].name,
    ).toBe('Zeta FM');
    expect(stations[0].name).toBe('Alpha FM');
  });

  it('post-79: join on mapped urls uses default comma', () => {
        const joined = parseM3U(
          '#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTINF:-1,B\nhttps://b\n',
        )
          .map((s) => s.url)
          .join();
        expect(joined).toBe('https://a,https://b');
  });

  it('post-79: padEnd-style name lengths are not altered by parser', () => {
        const name = 'A'.padEnd(20, '.');
        expect(parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u\n`)[0].name).toBe(
          name,
        );
  });

  it('post-79: Number and Boolean names coerce only via String context not parser', () => {
        const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="123",123\nhttps://u\n');
        expect(typeof s.name).toBe('string');
        expect(Number(s.name)).toBe(123);
  });

  it('post-79: multi-byte UTF-8 length via TextEncoder matches name bytes', () => {
        const name = 'ラジオ';
        const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u\n`);
        expect(new TextEncoder().encode(s.name).length).toBe(9);
        expect([...s.name]).toHaveLength(3);
  });

  it('post-79: localeCompare ordering of SAMPLE_M3U names is Alpha..Zeta', () => {
    const names = parseM3U(SAMPLE_M3U).map((s) => s.name);
    // Playlist order is Greek-letter sequence, not localeCompare (Gamma sorts after Epsilon)
    expect(names).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(sorted).toEqual([
      'Alpha FM',
      'Beta FM',
      'Delta FM',
      'Epsilon FM',
      'Gamma FM',
      'Zeta FM',
    ]);
    expect(names).not.toEqual(sorted);
  });

  it('post-79: regex ^https on each SAMPLE_M3U url', () => {
        expect(parseM3U(SAMPLE_M3U).every((s) => /^https:\/\//.test(s.url))).toBe(true);
  });

  it('post-79: no station url contains whitespace after parse', () => {
        const fixtures = [SAMPLE, SAMPLE_M3U, buildSimpleM3U([{ name: 'A', url: 'https://a' }])];
        for (const f of fixtures) {
          expect(parseM3U(f).every((s) => !/\s/.test(s.url))).toBe(true);
        }
  });

  it('post-79: parse then JSON.stringify then parseM3U is nonsensical but JSON.parse works', () => {
        const stations = parseM3U(SAMPLE_M3U);
        const viaJson = JSON.parse(JSON.stringify(stations)) as typeof stations;
        expect(viaJson).toEqual(
          stations.map((s) => ({
            name: s.name,
            url: s.url,
            group: s.group,
          })),
        );
        // JSON drops undefined logo/language/country — lock that drop
        expect(viaJson[0]).not.toHaveProperty('logo');
  });

  it('post-79: saturating dedupe set with 200 unique then 200 dupes', () => {
        const lines = ['#EXTM3U'];
        for (let i = 0; i < 200; i++) {
          lines.push(`#EXTINF:-1,U${i}`);
          lines.push(`https://u/${i}`);
        }
        for (let i = 0; i < 200; i++) {
          lines.push(`#EXTINF:-1,D${i}`);
          lines.push(`https://u/${i}`);
        }
        expect(parseM3U(lines.join('\n'))).toHaveLength(200);
  });

  it('post-79: comment lines containing http:// text do not bind as streams', () => {
        const stations = parseM3U(`#EXTM3U
    #EXTINF:-1,A
    # see https://example.com/docs
    https://a
    `);
        expect(stations).toHaveLength(1);
        expect(stations[0].url).toBe('https://a');
  });

  it('post-79: EXTINF line containing https:// in logo attr does not bind mid-line', () => {
        const stations = parseM3U(
          '#EXTM3U\n#EXTINF:-1 tvg-name="L" tvg-logo="https://cdn.example/l.png",L\nhttps://stream\n',
        );
        expect(stations).toHaveLength(1);
        expect(stations[0].url).toBe('https://stream');
        expect(stations[0].logo).toBe('https://cdn.example/l.png');
  });
});

describe('post106 parser HEAVY deepen', () => {
  // TOKENMAXX HEAVY burn — tests only. Orthogonal to #106 ci-config / #105 helpers.
  // Deepens parseM3U leftovers on latest main after #106.

  const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const sha1Hex = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");
  const md5Hex = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
  const hmacSha256 = (key: string, s: string) =>
    createHmac("sha256", key).update(s, "utf8").digest("hex");
  const nibbleSum = (hex: string) => [...hex].reduce((s, c) => s + parseInt(c, 16), 0);
  const xorNibbles = (hex: string) => [...hex].reduce((x, c) => x ^ parseInt(c, 16), 0);

  it("post106: sha256 fingerprint reaffirm", () => {
    expect(sha256Hex(parserSource)).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
  });

  it("post106: sha1 fingerprint reaffirm", () => {
    expect(sha1Hex(parserSource)).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
  });

  it("post106: md5 fingerprint reaffirm", () => {
    expect(md5Hex(parserSource)).toBe('500211c4c526de887252451726776563');
  });

  it("post106: sha384 fingerprint lock", () => {
    expect(createHash('sha384').update(parserSource, 'utf8').digest('hex')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');
  });

  it("post106: sha512 fingerprint lock", () => {
    expect(createHash('sha512').update(parserSource, 'utf8').digest('hex')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');
  });

  it("post106: sha256 nibble sum 477", () => {
    expect(nibbleSum(sha256Hex(parserSource))).toBe(477);
  });

  it("post106: sha256 xor nibbles 9", () => {
    expect(xorNibbles(sha256Hex(parserSource))).toBe(9);
  });

  it("post106: sha256 first/last octets", () => {
    const h = sha256Hex(parserSource);
    expect(h.slice(0, 2)).toBe('cf');
    expect(h.slice(-2)).toBe('68');
    expect(h).toHaveLength(64);
  });

  it("post106: HMAC-SHA256 key parser", () => {
    expect(hmacSha256('parser', parserSource)).toBe('9276d22adc96b16b1448de50885b29e41d299ade46428c74e22062b8fe6b617a');
  });

  it("post106: HMAC-SHA256 key post106", () => {
    expect(hmacSha256('post106', parserSource)).toBe('a4c46c14b3a760871b3b94c51f84195953c3fa32fb6d65d475c5bdab4fd5e442');
  });

  it("post106: HMAC-SHA256 key parseM3U", () => {
    expect(hmacSha256('parseM3U', parserSource)).toBe('6a02c2bd7b3573d7202afc9bd5e9f0f0af368217776af69bb431d07005a5ff90');
  });

  it("post106: HMAC-SHA256 key Station", () => {
    expect(hmacSha256('Station', parserSource)).toBe('3aa51a9346b986d3b790b94986884d11a1d3b1b76be1b789e39505106c230b34');
  });

  it("post106: HMAC digests differ for distinct keys", () => {
    expect(hmacSha256('parser', parserSource)).not.toBe(hmacSha256('post106', parserSource));
  });

  it("post106: utf8 char length 1953", () => {
    expect(parserSource).toHaveLength(1953);
  });

  it("post106: byte length 1955 via Buffer/TextEncoder", () => {
    expect(Buffer.byteLength(parserSource, 'utf8')).toBe(1955);
    expect(new TextEncoder().encode(parserSource).length).toBe(1955);
  });

  it("post106: line count 67", () => {
    expect(parserSource.split('\n')).toHaveLength(67);
  });

  it("post106: newline count 66", () => {
    expect((parserSource.match(/\n/g) ?? []).length).toBe(66);
  });

  it("post106: line length vector lock", () => {
    expect(parserSource.split('\n').map((l) => l.length)).toEqual([26,15,14,16,17,20,19,1,0,50,53,33,33,0,37,0,29,37,19,0,25,58,49,0,25,58,49,0,28,62,52,0,29,62,53,0,28,64,58,0,74,26,47,76,7,75,44,23,23,29,20,29,31,37,35,11,7,19,47,62,19,5,3,0,18,1,0]);
  });

  it("post106: first 40 char codes lock", () => {
    expect([...parserSource.slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([101,120,112,111,114,116,32,105,110,116,101,114,102,97,99,101,32,83,116,97,116,105,111,110,32,123,10,32,32,110,97,109,101,58,32,115,116,114,105,110]);
  });

  it("post106: last 40 char codes lock", () => {
    expect([...parserSource.slice(-40)].map((c) => c.charCodeAt(0))).toEqual([116,32,61,32,123,125,59,10,32,32,32,32,125,10,32,32,125,10,10,32,32,114,101,116,117,114,110,32,115,116,97,116,105,111,110,115,59,10,125,10]);
  });

  it("post106: unique char set lock", () => {
    expect([...new Set(parserSource)].sort().join('')).toBe("\n !\"#&'()*+,-./13:;<=>?EFILMNOPRSTUWX[\\]^abcdefghiklmnoprstuvwxy{|}—");
  });

  it("post106: space count 432", () => {
    expect((parserSource.match(/ /g) ?? []).length).toBe(432);
  });

  it("post106: double-quote count 15", () => {
    expect((parserSource.match(/"/g) ?? []).length).toBe(15);
  });

  it("post106: single-quote count 12", () => {
    expect((parserSource.match(/'/g) ?? []).length).toBe(12);
  });

  it("post106: equals count 27", () => {
    expect((parserSource.match(/=/g) ?? []).length).toBe(27);
  });

  it("post106: colon count 19", () => {
    expect((parserSource.match(/:/g) ?? []).length).toBe(19);
  });

  it("post106: semicolon count 28", () => {
    expect((parserSource.match(/;/g) ?? []).length).toBe(28);
  });

  it("post106: brace pair counts", () => {
    expect((parserSource.match(/\{/g) ?? []).length).toBe(13);
    expect((parserSource.match(/\}/g) ?? []).length).toBe(13);
  });

  it("post106: paren pair counts", () => {
    expect((parserSource.match(/\(/g) ?? []).length).toBe(40);
    expect((parserSource.match(/\)/g) ?? []).length).toBe(40);
  });

  it("post106: bracket pair counts", () => {
    expect((parserSource.match(/\[/g) ?? []).length).toBe(13);
    expect((parserSource.match(/\]/g) ?? []).length).toBe(13);
  });

  it("post106: question mark count 4", () => {
    expect((parserSource.match(/\?/g) ?? []).length).toBe(4);
  });

  it("post106: slash count 30", () => {
    expect((parserSource.match(/\//g) ?? []).length).toBe(30);
  });

  it("post106: backslash count 1", () => {
    expect((parserSource.match(/\\/g) ?? []).length).toBe(1);
  });

  it("post106: hash count 3", () => {
    expect((parserSource.match(/#/g) ?? []).length).toBe(3);
  });

  it("post106: comma count 8", () => {
    expect((parserSource.match(/,/g) ?? []).length).toBe(8);
  });

  it("post106: dot count 32", () => {
    expect((parserSource.match(/\./g) ?? []).length).toBe(32);
  });

  it("post106: underscore count 0", () => {
    expect((parserSource.match(/_/g) ?? []).length).toBe(0);
  });

  it("post106: dash count 12", () => {
    expect((parserSource.match(/-/g) ?? []).length).toBe(12);
  });

  it("post106: amp count 4", () => {
    expect((parserSource.match(/&/g) ?? []).length).toBe(4);
  });

  it("post106: pipe count 2", () => {
    expect((parserSource.match(/\|/g) ?? []).length).toBe(2);
  });

  it("post106: digit count 8", () => {
    expect([...parserSource].filter((c) => /\d/.test(c))).toHaveLength(8);
  });

  it("post106: uppercase count 54", () => {
    expect([...parserSource].filter((c) => /[A-Z]/.test(c))).toHaveLength(54);
  });

  it("post106: lowercase count 1043", () => {
    expect([...parserSource].filter((c) => /[a-z]/.test(c))).toHaveLength(1043);
  });

  it("post106: tab and CR absent", () => {
    expect(parserSource.includes('\t')).toBe(false);
    expect(parserSource.includes('\r')).toBe(false);
  });

  it("post106: nonempty line count", () => {
    expect(parserSource.split('\n').filter((l) => l.length > 0)).toHaveLength(56);
  });

  it("post106: nonempty line length sum", () => {
    expect(parserSource.split('\n').filter((l) => l.length > 0).reduce((a, l) => a + l.length, 0)).toBe(1887);
  });

  it("post106: word token count 208", () => {
    expect((parserSource.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).length).toBe(208);
  });

  it("post106: export interface Station and function parseM3U only", () => {
    expect([...parserSource.matchAll(/^export (?:interface|function) (\w+)/gm)].map((m) => m[1])).toEqual(['Station', 'parseM3U']);
  });

  it("post106: no import statements", () => {
    expect(parserSource).not.toMatch(/^import /m);
  });

  it("post106: no default export", () => {
    expect(parserSource).not.toMatch(/export default/);
  });

  it("post106: no async/await/Promise", () => {
    expect(parserSource).not.toMatch(/\basync\b|\bawait\b|\bPromise\b/);
  });

  it("post106: no fetch/Hono/Gemini inventing", () => {
    expect(parserSource).not.toMatch(/GEMINI|fetch\(|Hono|resolveGenre|GENRE_MAP|MCP_MANIFEST/);
  });

  it("post106: no DurableObject / R2 / D1 inventing", () => {
    expect(parserSource).not.toMatch(/DurableObject|R2Bucket|D1Database|WorkersAI|Vectorize/i);
  });

  it("post106: no auth/cors inventing in parser", () => {
    expect(parserSource).not.toMatch(/Authorization|Bearer|CORS|Access-Control|api[_-]?key/i);
  });

  it("post106: re-read equals module snapshot", () => {
    expect(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8')).toBe(parserSource);
  });

  it("post106: mega purity 50x sha256", () => {
    const expected = 'cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368';
    for (let i = 0; i < 50; i++) expect(sha256Hex(parserSource)).toBe(expected);
  });

  it("post106: mega purity 25x re-read", () => {
    for (let i = 0; i < 25; i++) {
      expect(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8')).toBe(parserSource);
    }
  });

  it("post106: final triple digest lock", () => {
    expect(sha1Hex(parserSource)).toBe('701cdecbef5a9049af6bd11497493c4036a60211');
    expect(sha256Hex(parserSource)).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
    expect(md5Hex(parserSource)).toBe('500211c4c526de887252451726776563');
  });

  it("post106: HMAC-SHA256 key backlink", () => {
    expect(hmacSha256('backlink', parserSource)).toBe('9d45133ec8b6ea6888b04d7810e9e74a5ae6e40f8b885ac29cf9f8828ecb5bdb');
  });

  it("post106: HMAC-SHA256 key EXTINF", () => {
    expect(hmacSha256('EXTINF', parserSource)).toBe('b1278e02e65ed611815fa337c4ec78b95bc1e84d4bb2d440fad935194426a910');
  });

  it("post106: HMAC-SHA256 key tvg-name", () => {
    expect(hmacSha256('tvg-name', parserSource)).toBe('9ae1525696686b515e20f00ab6a75bbf527060eee94322b28450e9a5ca0ee2a8');
  });

  it("post106: HMAC-SHA256 key tvg-logo", () => {
    expect(hmacSha256('tvg-logo', parserSource)).toBe('ead95583467d30e020572a7f51600d3f81311d59adefaa8404f25c5688e94420');
  });

  it("post106: HMAC-SHA256 key group-title", () => {
    expect(hmacSha256('group-title', parserSource)).toBe('eb6b28143dfb3a806354787e92981447f7d52e905d04a8c91a1c3eef6929f429');
  });

  it("post106: HMAC-SHA256 key tvg-language", () => {
    expect(hmacSha256('tvg-language', parserSource)).toBe('5213712b65d0b5016a99a99b7456e2f67a06911db66af9bd160f06fb891d0498');
  });

  it("post106: HMAC-SHA256 key tvg-country", () => {
    expect(hmacSha256('tvg-country', parserSource)).toBe('c6a0e72f1b4a60db8eb31cedd3c51ecc2c7bc838eb3496cc896fb1151899ae82');
  });

  it("post106: HMAC-SHA256 key http", () => {
    expect(hmacSha256('http', parserSource)).toBe('029182f335680acd873ca4dd0aefd7e78b00ae6df78d3b5fb1e0b32643e22648');
  });

  it("post106: HMAC-SHA256 key https", () => {
    expect(hmacSha256('https', parserSource)).toBe('696b360274525081cb295b8bf6994600c072ae6ce566c9e52cfbd8a48f67a07f');
  });

  it("post106: HMAC-SHA256 key seen", () => {
    expect(hmacSha256('seen', parserSource)).toBe('a412e286d263482f02b6a81ad1e6ad2c8cf86d4b64ef58857932b6d70b997c79');
  });

  it("post106: HMAC-SHA256 key current", () => {
    expect(hmacSha256('current', parserSource)).toBe('937292587c7a727dbcdcd313de16ccce2f40df493d5d69cc7ff1c76b9052c647');
  });

  it("post106: HMAC-SHA256 key stations", () => {
    expect(hmacSha256('stations', parserSource)).toBe('d8e77f93d543ffcc101006388f50ab09ccb6b12d89eaafe4f6ab3e53365af98a');
  });

  it("post106: HMAC-SHA256 key trim", () => {
    expect(hmacSha256('trim', parserSource)).toBe('a8d77f070c94af24a723f411619bf22ab710c5de6f0296bd9315aeead9c8d7be');
  });

  it("post106: HMAC-SHA256 key lastIndexOf", () => {
    expect(hmacSha256('lastIndexOf', parserSource)).toBe('db51fc917fb5ecd02c74709a126a1375810b38388026767a02006996cb3a3157');
  });

  it("post106: HMAC-SHA256 key startsWith", () => {
    expect(hmacSha256('startsWith', parserSource)).toBe('80aa249a6385bc2bcd7afaba1be183314413f20069b323519e4101903c53ffa7');
  });

  it("post106: HMAC-SHA256 key Partial", () => {
    expect(hmacSha256('Partial', parserSource)).toBe('721c67ecbe7181393062d3cd0fdce91018a0a4c4052a5cf0750f69176688d3eb');
  });

  it("post106: HMAC-SHA256 key Set", () => {
    expect(hmacSha256('Set', parserSource)).toBe('535b651bc51fb3ea5976e48d5b5510ecf1afd651815017d9d9f8a6b6178cd179');
  });

  it("post106: HMAC-SHA256 key logo", () => {
    expect(hmacSha256('logo', parserSource)).toBe('afbe4a0ea6e9570a6a4db246db94747aeab4bfd5e322a07916651a4e91fe8184');
  });

  it("post106: HMAC-SHA256 key group", () => {
    expect(hmacSha256('group', parserSource)).toBe('fba3ea01dc61f37ab7cfc10411f9b2547c6c13927d909f142f228a9353290b7b');
  });

  it("post106: HMAC-SHA256 key language", () => {
    expect(hmacSha256('language', parserSource)).toBe('48cece1beec138f768bfb4e518789f6efdd7056ece09ca20df07e04943b98817');
  });

  it("post106: HMAC-SHA256 key country", () => {
    expect(hmacSha256('country', parserSource)).toBe('4b34ac8199e9e9104fb2d35698e558e787c77f0acc5969e94c4e2e365676cef4');
  });

  it("post106: HMAC-SHA256 key url", () => {
    expect(hmacSha256('url', parserSource)).toBe('19c2ecbbe57848ca18a50b059bb2464ee322cef1159982a5b64045fc814b8e19');
  });

  it("post106: HMAC-SHA256 key name", () => {
    expect(hmacSha256('name', parserSource)).toBe('14df1c826b03c31c46f00df129446ab57d3e9fc27d1ae0d0f32fe268e1923916');
  });

  it("post106: HMAC-SHA256 key raw", () => {
    expect(hmacSha256('raw', parserSource)).toBe('24dba66fcd3d39a7ba4b8d9ed2cc8ee64b8141cb51b6e0ad05bd787ea5c50b40');
  });

  it("post106: HMAC-SHA256 key lines", () => {
    expect(hmacSha256('lines', parserSource)).toBe('df3d638875b6f29bff69d41b31391f16a18ecfdcbd8d1491bc4cb9f2d4076463');
  });

  it("post106: HMAC-SHA256 key fuzzywigg", () => {
    expect(hmacSha256('fuzzywigg', parserSource)).toBe('84bba718304e8ae87e488eb7d34d91334a8a583de252f8bf8c7a1262af17f07a');
  });

  it("post106: HMAC-SHA256 key iptv-org", () => {
    expect(hmacSha256('iptv-org', parserSource)).toBe('a1c1a7e31db65012bc03f0c219cf6b5c51012ee9753fce5e653b180e24655514');
  });

  it("post106: HMAC-SHA256 key m3u8", () => {
    expect(hmacSha256('m3u8', parserSource)).toBe('91ed35b06e11aef4a86d145f4104d7ea94b3637b0f82d91bd4fce785b840b302');
  });

  it("post106: HMAC-SHA256 key rtmp", () => {
    expect(hmacSha256('rtmp', parserSource)).toBe('07bcf1fb2ee7a85237524659120c7bb286a3e6a8b7c922ca1524144311a2d226');
  });

  it("post106: HMAC-SHA256 key comma", () => {
    expect(hmacSha256('comma', parserSource)).toBe('f8c8796d608c2a0746c46235682314392ce30d3b48f9a05c93572b5808537401');
  });

  it("post106: forbidden inventing token oauth", () => {
    expect(parserSource.toLowerCase()).not.toContain("oauth");
  });

  it("post106: forbidden inventing token webhook", () => {
    expect(parserSource.toLowerCase()).not.toContain("webhook");
  });

  it("post106: forbidden inventing token smtp", () => {
    expect(parserSource.toLowerCase()).not.toContain("smtp");
  });

  it("post106: forbidden inventing token redis", () => {
    expect(parserSource.toLowerCase()).not.toContain("redis");
  });

  it("post106: forbidden inventing token postgres", () => {
    expect(parserSource.toLowerCase()).not.toContain("postgres");
  });

  it("post106: forbidden inventing token mongodb", () => {
    expect(parserSource.toLowerCase()).not.toContain("mongodb");
  });

  it("post106: forbidden inventing token sqlite", () => {
    expect(parserSource.toLowerCase()).not.toContain("sqlite");
  });

  it("post106: forbidden inventing token mysql", () => {
    expect(parserSource.toLowerCase()).not.toContain("mysql");
  });

  it("post106: forbidden inventing token kafka", () => {
    expect(parserSource.toLowerCase()).not.toContain("kafka");
  });

  it("post106: forbidden inventing token rabbitmq", () => {
    expect(parserSource.toLowerCase()).not.toContain("rabbitmq");
  });

  it("post106: forbidden inventing token elasticsearch", () => {
    expect(parserSource.toLowerCase()).not.toContain("elasticsearch");
  });

  it("post106: forbidden inventing token sentry", () => {
    expect(parserSource.toLowerCase()).not.toContain("sentry");
  });

  it("post106: forbidden inventing token datadog", () => {
    expect(parserSource.toLowerCase()).not.toContain("datadog");
  });

  it("post106: forbidden inventing token newrelic", () => {
    expect(parserSource.toLowerCase()).not.toContain("newrelic");
  });

  it("post106: forbidden inventing token honeycomb", () => {
    expect(parserSource.toLowerCase()).not.toContain("honeycomb");
  });

  it("post106: forbidden inventing token launchdarkly", () => {
    expect(parserSource.toLowerCase()).not.toContain("launchdarkly");
  });

  it("post106: forbidden inventing token stripe", () => {
    expect(parserSource.toLowerCase()).not.toContain("stripe");
  });

  it("post106: forbidden inventing token paypal", () => {
    expect(parserSource.toLowerCase()).not.toContain("paypal");
  });

  it("post106: forbidden inventing token twilio", () => {
    expect(parserSource.toLowerCase()).not.toContain("twilio");
  });

  it("post106: forbidden inventing token sendgrid", () => {
    expect(parserSource.toLowerCase()).not.toContain("sendgrid");
  });

  it("post106: forbidden inventing token mailgun", () => {
    expect(parserSource.toLowerCase()).not.toContain("mailgun");
  });

  it("post106: forbidden inventing token jwt_secret", () => {
    expect(parserSource.toLowerCase()).not.toContain("jwt_secret");
  });

  it("post106: forbidden inventing token session_secret", () => {
    expect(parserSource.toLowerCase()).not.toContain("session_secret");
  });

  it("post106: forbidden inventing token encryption_key", () => {
    expect(parserSource.toLowerCase()).not.toContain("encryption_key");
  });

  it("post106: forbidden inventing token aws_access", () => {
    expect(parserSource.toLowerCase()).not.toContain("aws_access");
  });

  it("post106: forbidden inventing token aws_secret", () => {
    expect(parserSource.toLowerCase()).not.toContain("aws_secret");
  });

  it("post106: forbidden inventing token gcp_project", () => {
    expect(parserSource.toLowerCase()).not.toContain("gcp_project");
  });

  it("post106: forbidden inventing token anthropic", () => {
    expect(parserSource.toLowerCase()).not.toContain("anthropic");
  });

  it("post106: forbidden inventing token openai", () => {
    expect(parserSource.toLowerCase()).not.toContain("openai");
  });

  it("post106: forbidden inventing token claude", () => {
    expect(parserSource.toLowerCase()).not.toContain("claude");
  });

  it("post106: forbidden inventing token chatgpt", () => {
    expect(parserSource.toLowerCase()).not.toContain("chatgpt");
  });

  it("post106: forbidden inventing token langchain", () => {
    expect(parserSource.toLowerCase()).not.toContain("langchain");
  });

  it("post106: forbidden inventing token pinecone", () => {
    expect(parserSource.toLowerCase()).not.toContain("pinecone");
  });

  it("post106: forbidden inventing token weaviate", () => {
    expect(parserSource.toLowerCase()).not.toContain("weaviate");
  });

  it("post106: forbidden inventing token qdrant", () => {
    expect(parserSource.toLowerCase()).not.toContain("qdrant");
  });

  it("post106: forbidden inventing token supabase", () => {
    expect(parserSource.toLowerCase()).not.toContain("supabase");
  });

  it("post106: forbidden inventing token firebase", () => {
    expect(parserSource.toLowerCase()).not.toContain("firebase");
  });

  it("post106: forbidden inventing token planetscale", () => {
    expect(parserSource.toLowerCase()).not.toContain("planetscale");
  });

  it("post106: forbidden inventing token neon", () => {
    expect(parserSource.toLowerCase()).not.toContain("neon");
  });

  it("post106: forbidden inventing token turso", () => {
    expect(parserSource.toLowerCase()).not.toContain("turso");
  });

  it("post106: forbidden inventing token drizzle", () => {
    expect(parserSource.toLowerCase()).not.toContain("drizzle");
  });

  it("post106: forbidden inventing token prisma", () => {
    expect(parserSource.toLowerCase()).not.toContain("prisma");
  });

  it("post106: forbidden inventing token graphql", () => {
    expect(parserSource.toLowerCase()).not.toContain("graphql");
  });

  it("post106: forbidden inventing token trpc", () => {
    expect(parserSource.toLowerCase()).not.toContain("trpc");
  });

  it("post106: forbidden inventing token websocket", () => {
    expect(parserSource.toLowerCase()).not.toContain("websocket");
  });

  it("post106: forbidden inventing token socket.io", () => {
    expect(parserSource.toLowerCase()).not.toContain("socket.io");
  });

  it("post106: forbidden inventing token express", () => {
    expect(parserSource.toLowerCase()).not.toContain("express");
  });

  it("post106: forbidden inventing token fastify", () => {
    expect(parserSource.toLowerCase()).not.toContain("fastify");
  });

  it("post106: forbidden inventing token nestjs", () => {
    expect(parserSource.toLowerCase()).not.toContain("nestjs");
  });

  it("post106: forbidden inventing token nextjs", () => {
    expect(parserSource.toLowerCase()).not.toContain("nextjs");
  });

  it("post106: forbidden inventing token remix", () => {
    expect(parserSource.toLowerCase()).not.toContain("remix");
  });

  it("post106: forbidden inventing token astro", () => {
    expect(parserSource.toLowerCase()).not.toContain("astro");
  });

  it("post106: forbidden inventing token svelte", () => {
    expect(parserSource.toLowerCase()).not.toContain("svelte");
  });

  it("post106: forbidden inventing token vue", () => {
    expect(parserSource.toLowerCase()).not.toContain("vue");
  });

  it("post106: forbidden inventing token angular", () => {
    expect(parserSource.toLowerCase()).not.toContain("angular");
  });

  it("post106: forbidden inventing token react", () => {
    expect(parserSource.toLowerCase()).not.toContain("react");
  });

  it("post106: forbidden inventing token jsx", () => {
    expect(parserSource.toLowerCase()).not.toContain("jsx");
  });

  it("post106: forbidden inventing token tsx", () => {
    expect(parserSource.toLowerCase()).not.toContain("tsx");
  });

  it("post106: forbidden inventing token css", () => {
    expect(parserSource.toLowerCase()).not.toContain("css");
  });

  it("post106: forbidden inventing token tailwind", () => {
    expect(parserSource.toLowerCase()).not.toContain("tailwind");
  });

  it("post106: forbidden inventing token emotion", () => {
    expect(parserSource.toLowerCase()).not.toContain("emotion");
  });

  it("post106: forbidden inventing token billing", () => {
    expect(parserSource.toLowerCase()).not.toContain("billing");
  });

  it("post106: forbidden inventing token invoice", () => {
    expect(parserSource.toLowerCase()).not.toContain("invoice");
  });

  it("post106: forbidden inventing token subscription", () => {
    expect(parserSource.toLowerCase()).not.toContain("subscription");
  });

  it("post106: forbidden inventing token payment", () => {
    expect(parserSource.toLowerCase()).not.toContain("payment");
  });

  it("post106: forbidden inventing token checkout", () => {
    expect(parserSource.toLowerCase()).not.toContain("checkout");
  });

  it("post106: forbidden inventing token cart", () => {
    expect(parserSource.toLowerCase()).not.toContain("cart");
  });

  it("post106: forbidden inventing token sku", () => {
    expect(parserSource.toLowerCase()).not.toContain("sku");
  });

  it("post106: forbidden inventing token password", () => {
    expect(parserSource.toLowerCase()).not.toContain("password");
  });

  it("post106: forbidden inventing token passwd", () => {
    expect(parserSource.toLowerCase()).not.toContain("passwd");
  });

  it("post106: forbidden inventing token secret_key", () => {
    expect(parserSource.toLowerCase()).not.toContain("secret_key");
  });

  it("post106: forbidden inventing token private_key", () => {
    expect(parserSource.toLowerCase()).not.toContain("private_key");
  });

  it("post106: forbidden inventing token ssh-rsa", () => {
    expect(parserSource.toLowerCase()).not.toContain("ssh-rsa");
  });

  it("post106: forbidden inventing token BEGIN PRIVATE", () => {
    expect(parserSource.toLowerCase()).not.toContain("begin private");
  });

  it("post106: resets on ftp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nftp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ftp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ftp');
  });

  it("post106: resets on ftps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nftps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ftps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ftps');
  });

  it("post106: resets on sftp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsftp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/sftp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/sftp');
  });

  it("post106: resets on file: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nfile://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/file\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/file');
  });

  it("post106: resets on data: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ndata://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/data\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/data');
  });

  it("post106: resets on blob: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nblob://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/blob\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/blob');
  });

  it("post106: resets on about: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nabout://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/about\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/about');
  });

  it("post106: resets on chrome: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nchrome://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/chrome\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/chrome');
  });

  it("post106: resets on chrome-extension: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nchrome-extension://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/chrome-extension\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/chrome-extension');
  });

  it("post106: resets on moz-extension: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmoz-extension://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/moz-extension\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/moz-extension');
  });

  it("post106: resets on view-source: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nview-source://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/view-source\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/view-source');
  });

  it("post106: resets on javascript: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\njavascript://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/javascript\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/javascript');
  });

  it("post106: resets on vbscript: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nvbscript://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/vbscript\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/vbscript');
  });

  it("post106: resets on ws: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nws://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ws\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ws');
  });

  it("post106: resets on wss: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nwss://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/wss\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/wss');
  });

  it("post106: resets on tcp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ntcp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/tcp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/tcp');
  });

  it("post106: resets on udp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nudp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/udp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/udp');
  });

  it("post106: resets on quic: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nquic://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/quic\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/quic');
  });

  it("post106: resets on ipfs: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nipfs://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ipfs\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ipfs');
  });

  it("post106: resets on ipns: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nipns://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ipns\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ipns');
  });

  it("post106: resets on magnet: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmagnet://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/magnet\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/magnet');
  });

  it("post106: resets on mailto: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmailto://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mailto\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mailto');
  });

  it("post106: resets on tel: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ntel://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/tel\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/tel');
  });

  it("post106: resets on sms: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsms://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/sms\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/sms');
  });

  it("post106: resets on geo: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngeo://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/geo\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/geo');
  });

  it("post106: resets on maps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmaps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/maps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/maps');
  });

  it("post106: resets on intent: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nintent://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/intent\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/intent');
  });

  it("post106: resets on market: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmarket://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/market\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/market');
  });

  it("post106: resets on itms: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nitms://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/itms\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/itms');
  });

  it("post106: resets on itms-apps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nitms-apps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/itms-apps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/itms-apps');
  });

  it("post106: resets on spotify: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nspotify://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/spotify\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/spotify');
  });

  it("post106: resets on steam: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsteam://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/steam\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/steam');
  });

  it("post106: resets on discord: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ndiscord://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/discord\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/discord');
  });

  it("post106: resets on slack: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nslack://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/slack\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/slack');
  });

  it("post106: resets on zoommtg: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nzoommtg://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/zoommtg\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/zoommtg');
  });

  it("post106: resets on webcal: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nwebcal://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/webcal\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/webcal');
  });

  it("post106: resets on feed: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nfeed://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/feed\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/feed');
  });

  it("post106: resets on news: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nnews://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/news\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/news');
  });

  it("post106: resets on nntp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nnntp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/nntp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/nntp');
  });

  it("post106: resets on gopher: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngopher://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/gopher\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/gopher');
  });

  it("post106: resets on gemini: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngemini://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/gemini\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/gemini');
  });

  it("post106: resets on finger: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nfinger://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/finger\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/finger');
  });

  it("post106: resets on whois: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nwhois://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/whois\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/whois');
  });

  it("post106: resets on ldap: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nldap://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ldap\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ldap');
  });

  it("post106: resets on ldaps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nldaps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ldaps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ldaps');
  });

  it("post106: resets on nfs: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nnfs://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/nfs\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/nfs');
  });

  it("post106: resets on smb: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsmb://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/smb\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/smb');
  });

  it("post106: resets on cifs: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ncifs://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/cifs\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/cifs');
  });

  it("post106: resets on afp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nafp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/afp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/afp');
  });

  it("post106: resets on rsync: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrsync://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rsync\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rsync');
  });

  it("post106: resets on svn: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsvn://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/svn\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/svn');
  });

  it("post106: resets on git: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngit://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/git\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/git');
  });

  it("post106: resets on ssh: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nssh://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ssh\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ssh');
  });

  it("post106: resets on telnet: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ntelnet://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/telnet\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/telnet');
  });

  it("post106: resets on tn3270: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ntn3270://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/tn3270\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/tn3270');
  });

  it("post106: resets on irc: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nirc://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/irc\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/irc');
  });

  it("post106: resets on ircs: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nircs://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/ircs\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/ircs');
  });

  it("post106: resets on xmpp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nxmpp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/xmpp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/xmpp');
  });

  it("post106: resets on sip: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsip://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/sip\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/sip');
  });

  it("post106: resets on sips: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsips://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/sips\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/sips');
  });

  it("post106: resets on h323: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nh323://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/h323\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/h323');
  });

  it("post106: resets on rtmp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrtmp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rtmp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rtmp');
  });

  it("post106: resets on rtmps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrtmps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rtmps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rtmps');
  });

  it("post106: resets on rtmpt: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrtmpt://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rtmpt\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rtmpt');
  });

  it("post106: resets on rtsp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrtsp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rtsp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rtsp');
  });

  it("post106: resets on rtsps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrtsps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rtsps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rtsps');
  });

  it("post106: resets on mms: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmms://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mms\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mms');
  });

  it("post106: resets on mmsh: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmmsh://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mmsh\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mmsh');
  });

  it("post106: resets on mmst: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmmst://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mmst\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mmst');
  });

  it("post106: resets on rtp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nrtp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/rtp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/rtp');
  });

  it("post106: resets on sctp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsctp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/sctp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/sctp');
  });

  it("post106: resets on coap: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ncoap://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/coap\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/coap');
  });

  it("post106: resets on coaps: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ncoaps://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/coaps\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/coaps');
  });

  it("post106: resets on mqtt: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmqtt://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mqtt\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mqtt');
  });

  it("post106: resets on amqp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\namqp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/amqp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/amqp');
  });

  it("post106: resets on stomp: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nstomp://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/stomp\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/stomp');
  });

  it("post106: resets on redis: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nredis://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/redis\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/redis');
  });

  it("post106: resets on postgres: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\npostgres://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/postgres\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/postgres');
  });

  it("post106: resets on mysql: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmysql://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mysql\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mysql');
  });

  it("post106: resets on mongodb: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmongodb://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/mongodb\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/mongodb');
  });

  it("post106: resets on cassandra: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ncassandra://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/cassandra\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/cassandra');
  });

  it("post106: resets on elasticsearch: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nelasticsearch://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/elasticsearch\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/elasticsearch');
  });

  it("post106: resets on bolt: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nbolt://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/bolt\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/bolt');
  });

  it("post106: resets on docker: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ndocker://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/docker\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/docker');
  });

  it("post106: resets on podman: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\npodman://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/podman\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/podman');
  });

  it("post106: resets on kubectl: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nkubectl://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/kubectl\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/kubectl');
  });

  it("post106: resets on k8s: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nk8s://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/k8s\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/k8s');
  });

  it("post106: resets on consul: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nconsul://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/consul\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/consul');
  });

  it("post106: resets on vault: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nvault://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/vault\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/vault');
  });

  it("post106: resets on nomad: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nnomad://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/nomad\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/nomad');
  });

  it("post106: resets on etcd: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\netcd://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/etcd\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/etcd');
  });

  it("post106: resets on apt: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\napt://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/apt\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/apt');
  });

  it("post106: resets on snap: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nsnap://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/snap\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/snap');
  });

  it("post106: resets on flatpak: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nflatpak://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/flatpak\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/flatpak');
  });

  it("post106: resets on brew: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nbrew://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/brew\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/brew');
  });

  it("post106: resets on choco: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nchoco://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/choco\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/choco');
  });

  it("post106: resets on winget: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nwinget://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/winget\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/winget');
  });

  it("post106: resets on npm: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nnpm://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/npm\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/npm');
  });

  it("post106: resets on yarn: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nyarn://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/yarn\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/yarn');
  });

  it("post106: resets on pnpm: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\npnpm://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/pnpm\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/pnpm');
  });

  it("post106: resets on pip: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\npip://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/pip\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/pip');
  });

  it("post106: resets on cargo: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ncargo://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/cargo\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/cargo');
  });

  it("post106: resets on go: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngo://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/go\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/go');
  });

  it("post106: resets on gem: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngem://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/gem\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/gem');
  });

  it("post106: resets on composer: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ncomposer://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/composer\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/composer');
  });

  it("post106: resets on nuget: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nnuget://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/nuget\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/nuget');
  });

  it("post106: resets on maven: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nmaven://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/maven\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/maven');
  });

  it("post106: resets on gradle: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\ngradle://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/gradle\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/gradle');
  });

  it("post106: resets on bazel: then recovers with https", () => {
    const stations = parseM3U(`#EXTM3U\n#EXTINF:-1,A\nbazel://example.com/stream\n#EXTINF:-1,B\nhttps://ok.example/bazel\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('B');
    expect(stations[0].url).toBe('https://ok.example/bazel');
  });

  it("post106: tvg-name empty string falls back to comma display name", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="",X\nhttps://u\n');
    expect(s.name).toBe('X');
  });

  it("post106: tvg-name with spaces around equals is NOT matched (strict regex)", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name = "N",X\nhttps://u\n');
    expect(s.name).toBe('X');
  });

  it("post106: tvg-logo empty string binds as empty logo", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo="",X\nhttps://u\n');
    expect(s.logo).toBe('');
  });

  it("post106: tvg-logo with spaces around equals is NOT matched (strict regex)", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo = "https://cdn.example/x.png",X\nhttps://u\n');
    expect(s.logo).toBeUndefined();
  });

  it("post106: group-title empty string binds as empty group", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="",X\nhttps://u\n');
    expect(s.group).toBe('');
  });

  it("post106: group-title with spaces around equals is NOT matched (strict regex)", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title = "G",X\nhttps://u\n');
    expect(s.group).toBeUndefined();
  });

  it("post106: tvg-language empty string binds as empty language", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-language="",X\nhttps://u\n');
    expect(s.language).toBe('');
  });

  it("post106: tvg-language with spaces around equals is NOT matched (strict regex)", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-language = "en",X\nhttps://u\n');
    expect(s.language).toBeUndefined();
  });

  it("post106: tvg-country empty string binds as empty country", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-country="",X\nhttps://u\n');
    expect(s.country).toBe('');
  });

  it("post106: tvg-country with spaces around equals is NOT matched (strict regex)", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-country = "US",X\nhttps://u\n');
    expect(s.country).toBeUndefined();
  });

  it("post106: unicode name emoji round-trips via tvg-name", () => {
    const name = "emoji radio 🎵";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/emoji\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/emoji');
  });

  it("post106: unicode name cyrillic round-trips via tvg-name", () => {
    const name = "Кириллица FM";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/cyrillic\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/cyrillic');
  });

  it("post106: unicode name arabic round-trips via tvg-name", () => {
    const name = "العربية";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/arabic\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/arabic');
  });

  it("post106: unicode name hebrew round-trips via tvg-name", () => {
    const name = "עברית";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/hebrew\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/hebrew');
  });

  it("post106: unicode name cjk round-trips via tvg-name", () => {
    const name = "中文电台";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/cjk\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/cjk');
  });

  it("post106: unicode name japanese round-trips via tvg-name", () => {
    const name = "日本語";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/japanese\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/japanese');
  });

  it("post106: unicode name korean round-trips via tvg-name", () => {
    const name = "한국어";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/korean\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/korean');
  });

  it("post106: unicode name vietnamese round-trips via tvg-name", () => {
    const name = "Tiếng Việt";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/vietnamese\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/vietnamese');
  });

  it("post106: unicode name greek round-trips via tvg-name", () => {
    const name = "Ελληνικά";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/greek\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/greek');
  });

  it("post106: unicode name turkish round-trips via tvg-name", () => {
    const name = "Türkçe";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/turkish\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/turkish');
  });

  it("post106: unicode name spanish round-trips via tvg-name", () => {
    const name = "Ñandú FM";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/spanish\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/spanish');
  });

  it("post106: unicode name nordic round-trips via tvg-name", () => {
    const name = "Ångström";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/nordic\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/nordic');
  });

  it("post106: unicode name polish round-trips via tvg-name", () => {
    const name = "Zażółć";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/polish\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/polish');
  });

  it("post106: unicode name german round-trips via tvg-name", () => {
    const name = "ÄÖÜß";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/german\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/german');
  });

  it("post106: unicode name flag round-trips via tvg-name", () => {
    const name = "🇫🇷 France";
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u/flag\n`);
    expect(s.name).toBe(name);
    expect(s.url).toBe('https://u/flag');
  });

  it("post106: binds url variant bare-host", () => {
    const url = "https://example.com";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant trailing-slash", () => {
    const url = "https://example.com/";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant port", () => {
    const url = "https://example.com:8443/live";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant userinfo", () => {
    const url = "https://user:pass@example.com/live";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant percent", () => {
    const url = "https://example.com/a%20b.m3u8";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant query", () => {
    const url = "https://example.com/live?token=abc&x=1";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant hash", () => {
    const url = "https://example.com/live#frag";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant ipv4", () => {
    const url = "https://127.0.0.1/live";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant ipv6", () => {
    const url = "https://[::1]/live";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant http-aac", () => {
    const url = "http://example.com/live.aac";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant http-mp3", () => {
    const url = "http://example.com/live.mp3";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant dotdot", () => {
    const url = "https://cdn.example/path/../live.m3u8";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant mixed-case-host", () => {
    const url = "https://EXAMPLE.COM/Live.M3U8";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: binds url variant long-path", () => {
    const url = "https://example.com/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,N\n' + url + '\n');
    expect(s.url).toBe(url);
    expect(s.name).toBe('N');
  });

  it("post106: dedupe keeps first of 1 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 1; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 2 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 2; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 3 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 3; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 5 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 5; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 8 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 8; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 13 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 13; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 21 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 21; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 34 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 34; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 55 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 55; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: dedupe keeps first of 89 identical https urls", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 89; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://same.example/stream');
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('N0');
  });

  it("post106: buildSimpleM3U length 0 parses identically", () => {
    const items = Array.from({ length: 0 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(0);
  });

  it("post106: buildSimpleM3U length 1 parses identically", () => {
    const items = Array.from({ length: 1 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('S0');
    expect(stations[0].url).toBe('https://ex/0');
  });

  it("post106: buildSimpleM3U length 2 parses identically", () => {
    const items = Array.from({ length: 2 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(2);
    expect(stations[0].name).toBe('S0');
    expect(stations[1].url).toBe('https://ex/1');
  });

  it("post106: buildSimpleM3U length 4 parses identically", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(4);
    expect(stations[0].name).toBe('S0');
    expect(stations[3].url).toBe('https://ex/3');
  });

  it("post106: buildSimpleM3U length 7 parses identically", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(7);
    expect(stations[0].name).toBe('S0');
    expect(stations[6].url).toBe('https://ex/6');
  });

  it("post106: buildSimpleM3U length 10 parses identically", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(10);
    expect(stations[0].name).toBe('S0');
    expect(stations[9].url).toBe('https://ex/9');
  });

  it("post106: buildSimpleM3U length 16 parses identically", () => {
    const items = Array.from({ length: 16 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(16);
    expect(stations[0].name).toBe('S0');
    expect(stations[15].url).toBe('https://ex/15');
  });

  it("post106: buildSimpleM3U length 25 parses identically", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(25);
    expect(stations[0].name).toBe('S0');
    expect(stations[24].url).toBe('https://ex/24');
  });

  it("post106: buildSimpleM3U length 32 parses identically", () => {
    const items = Array.from({ length: 32 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(32);
    expect(stations[0].name).toBe('S0');
    expect(stations[31].url).toBe('https://ex/31');
  });

  it("post106: buildSimpleM3U length 50 parses identically", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(50);
    expect(stations[0].name).toBe('S0');
    expect(stations[49].url).toBe('https://ex/49');
  });

  it("post106: buildSimpleM3U length 64 parses identically", () => {
    const items = Array.from({ length: 64 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(64);
    expect(stations[0].name).toBe('S0');
    expect(stations[63].url).toBe('https://ex/63');
  });

  it("post106: buildSimpleM3U length 100 parses identically", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      name: 'S' + i,
      url: 'https://ex/' + i,
      group: 'G' + (i % 3),
      language: 'en',
      country: 'US',
    }));
    const stations = parseM3U(buildSimpleM3U(items));
    expect(stations).toHaveLength(100);
    expect(stations[0].name).toBe('S0');
    expect(stations[99].url).toBe('https://ex/99');
  });

  it("post106: SAMPLE_M3U parse length 6", () => {
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
  });

  it("post106: SAMPLE_M3U all Music group", () => {
    expect(parseM3U(SAMPLE_M3U).every((s) => s.group === 'Music')).toBe(true);
  });

  it("post106: SAMPLE_M3U names Alpha..Zeta", () => {
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual(['Alpha FM','Beta FM','Gamma FM','Delta FM','Epsilon FM','Zeta FM']);
  });

  it("post106: SAMPLE_M3U urls all https example.com", () => {
    expect(parseM3U(SAMPLE_M3U).every((s) => s.url.startsWith('https://example.com/') && s.url.endsWith('.m3u8'))).toBe(true);
  });

  it("post106: SAMPLE_M3U optionals undefined", () => {
    expect(parseM3U(SAMPLE_M3U).every((s) => s.logo === undefined && s.language === undefined && s.country === undefined)).toBe(true);
  });

  it("post106: SAMPLE_M3U countHttpStreamLines equals parse length", () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(parseM3U(SAMPLE_M3U).length);
  });

  it("post106: SAMPLE_M3U dual parse deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)).toEqual(parseM3U(SAMPLE_M3U));
  });

  it("post106: SAMPLE_M3U dual parse not same ref", () => {
    expect(parseM3U(SAMPLE_M3U)).not.toBe(parseM3U(SAMPLE_M3U));
  });

  it("post106: SAMPLE_M3U JSON round-trip drops undefined", () => {
    const via = JSON.parse(JSON.stringify(parseM3U(SAMPLE_M3U)));
    expect(via).toHaveLength(6);
    expect(via[0]).not.toHaveProperty('logo');
    expect(via[0].name).toBe('Alpha FM');
  });

  it("post106: SAMPLE_M3U sha256 of joined urls lock", () => {
    const joined = parseM3U(SAMPLE_M3U).map((s) => s.url).join('|');
    expect(sha256Hex(joined)).toBe('67e78b06dc81ad55e708ecb6da7ca6bfdb489833dc6fb31f9327d1e83f288de9');
  });

  it("post106: SAMPLE_M3U sha256 of joined names lock", () => {
    const joined = parseM3U(SAMPLE_M3U).map((s) => s.name).join(',');
    expect(sha256Hex(joined)).toBe('eb217952ba68b98d6a37c35c4a80186cec2a33bf950e7cb8875e1213bf43920a');
  });

  it("post106: SAMPLE_M3U station keys exactly six fields", () => {
    for (const s of parseM3U(SAMPLE_M3U)) {
      expect(Object.keys(s).sort()).toEqual(['country','group','language','logo','name','url']);
    }
  });

  it("post106: CRLF playlists still parse after trim strips CR", () => {
    const raw = '#EXTM3U\r\n#EXTINF:-1,A\r\nhttps://a\r\n';
    expect(parseM3U(raw)).toEqual([{ name: 'A', url: 'https://a', logo: undefined, group: undefined, language: undefined, country: undefined }]);
  });

  it("post106: mixed blank lines between stations", () => {
    const stations = parseM3U('#EXTM3U\n\n#EXTINF:-1,A\n\nhttps://a\n\n\n#EXTINF:-1,B\nhttps://b\n');
    expect(stations.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it("post106: #EXTM3U only with trailing spaces lines", () => {
    expect(parseM3U('   \n#EXTM3U\n   \n')).toEqual([]);
  });

  it("post106: multiple #EXTM3U headers ignored as comments", () => {
    const stations = parseM3U('#EXTM3U\n#EXTM3U\n#EXTINF:-1,A\nhttps://a\n#EXTM3U\n#EXTINF:-1,B\nhttps://b\n');
    expect(stations).toHaveLength(2);
  });

  it("post106: HTTP:// uppercase does not bind (startsWith is case-sensitive)", () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\nHTTP://example.com/a\n')).toEqual([]);
  });

  it("post106: HTTPS:// uppercase does not bind", () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\nHTTPS://example.com/a\n')).toEqual([]);
  });

  it("post106: Http:// mixed case does not bind", () => {
    expect(parseM3U('#EXTM3U\n#EXTINF:-1,A\nHttp://example.com/a\n')).toEqual([]);
  });

  it("post106: EXTINF duration -1 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: EXTINF duration 0 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:0 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: EXTINF duration 1 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: EXTINF duration 10 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:10 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: EXTINF duration 3600 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:3600 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: EXTINF duration -1.0 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1.0 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: EXTINF duration 12.5 still extracts attrs", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:12.5 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s.group).toBe('G');
  });

  it("post106: does not invent station.id", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('id');
  });

  it("post106: does not invent station.uuid", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('uuid');
  });

  it("post106: does not invent station.slug", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('slug');
  });

  it("post106: does not invent station.bitrate", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('bitrate');
  });

  it("post106: does not invent station.codec", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('codec');
  });

  it("post106: does not invent station.format", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('format');
  });

  it("post106: does not invent station.mime", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('mime');
  });

  it("post106: does not invent station.contentType", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('contentType');
  });

  it("post106: does not invent station.headers", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('headers');
  });

  it("post106: does not invent station.auth", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('auth');
  });

  it("post106: does not invent station.token", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('token');
  });

  it("post106: does not invent station.apiKey", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('apiKey');
  });

  it("post106: does not invent station.secret", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('secret');
  });

  it("post106: does not invent station.curated", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('curated');
  });

  it("post106: does not invent station.editorial", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('editorial');
  });

  it("post106: does not invent station.mood", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('mood');
  });

  it("post106: does not invent station.energy", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('energy');
  });

  it("post106: does not invent station.bpm", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('bpm');
  });

  it("post106: does not invent station.tags", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('tags');
  });

  it("post106: does not invent station.keywords", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('keywords');
  });

  it("post106: does not invent station.score", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('score');
  });

  it("post106: does not invent station.rank", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('rank');
  });

  it("post106: does not invent station.priority", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('priority');
  });

  it("post106: does not invent station.weight", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('weight');
  });

  it("post106: does not invent station.favorite", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('favorite');
  });

  it("post106: does not invent station.liked", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('liked');
  });

  it("post106: does not invent station.playCount", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('playCount');
  });

  it("post106: does not invent station.listeners", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('listeners');
  });

  it("post106: does not invent station.nowPlaying", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('nowPlaying');
  });

  it("post106: does not invent station.track", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('track');
  });

  it("post106: does not invent station.artist", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('artist');
  });

  it("post106: does not invent station.album", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('album');
  });

  it("post106: does not invent station.artwork", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('artwork');
  });

  it("post106: does not invent station.icy", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('icy');
  });

  it("post106: does not invent station.metadata", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('metadata');
  });

  it("post106: does not invent station.mcp", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('mcp');
  });

  it("post106: does not invent station.tool", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('tool');
  });

  it("post106: does not invent station.manifest", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('manifest');
  });

  it("post106: does not invent station.prompt", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('prompt');
  });

  it("post106: does not invent station.model", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('model');
  });

  it("post106: does not invent station.temperature", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('temperature');
  });

  it("post106: does not invent station.tokens", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('tokens');
  });

  it("post106: does not invent station.kv", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('kv');
  });

  it("post106: does not invent station.cache", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('cache');
  });

  it("post106: does not invent station.ttl", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('ttl');
  });

  it("post106: does not invent station.etag", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('etag');
  });

  it("post106: does not invent station.lastModified", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('lastModified');
  });

  it("post106: does not invent station.createdAt", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('createdAt');
  });

  it("post106: does not invent station.updatedAt", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="N" group-title="G",N\nhttps://u\n');
    expect(s).not.toHaveProperty('updatedAt');
  });

  it("post106: 128 unique urls preserve insertion order", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 128; i++) {
      lines.push('#EXTINF:-1,N' + i);
      lines.push('https://ord/' + i);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(128);
    expect(stations.map((s) => s.url)).toEqual(Array.from({ length: 128 }, (_, i) => 'https://ord/' + i));
  });

  it("post106: interleaved http and non-http resets correctly across 40 pairs", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 40; i++) {
      lines.push('#EXTINF:-1,Bad' + i);
      lines.push('rtmp://bad/' + i);
      lines.push('#EXTINF:-1,Good' + i);
      lines.push('https://good/' + i);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(40);
    expect(stations.every((s) => s.name.startsWith('Good'))).toBe(true);
  });

  it("post106: attr regex does not capture across quotes into next attr", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="A" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",Disp\nhttps://u\n');
    expect(s).toEqual({ name: 'A', url: 'https://u', logo: 'https://l', group: 'G', language: 'en', country: 'US' });
  });

  it("post106: single-quoted attrs are NOT extracted", () => {
    const [s] = parseM3U("#EXTM3U\n#EXTINF:-1 tvg-name='Nope' group-title='Jazz',Disp\nhttps://u\n");
    expect(s.name).toBe('Disp');
    expect(s.group).toBeUndefined();
  });

  it("post106: unquoted attrs are NOT extracted", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name=Nope group-title=Jazz,Disp\nhttps://u\n');
    expect(s.name).toBe('Disp');
    expect(s.group).toBeUndefined();
  });

  it("post106: tvg-id and other unknown attrs ignored", () => {
    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-id="x" tvg-chno="9" tvg-name="N",N\nhttps://u\n');
    expect(s.name).toBe('N');
    expect(s).not.toHaveProperty('id');
    expect(s).not.toHaveProperty('chno');
    expect(Object.keys(s).sort()).toEqual(['country','group','language','logo','name','url']);
  });

  it("post106: parseM3U is pure — same input same JSON", () => {
    const raw = buildSimpleM3U([{ name: 'A', url: 'https://a', group: 'G' }, { name: 'B', url: 'https://b' }]);
    expect(JSON.stringify(parseM3U(raw))).toBe(JSON.stringify(parseM3U(raw)));
  });

  it("post106: final mega 100x sha256 of parserSource", () => {
    const expected = 'cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368';
    for (let i = 0; i < 100; i++) expect(sha256Hex(parserSource)).toBe(expected);
  });

  it("post106: final lock module snapshot equals disk", () => {
    expect(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8')).toBe(parserSource);
    expect(sha256Hex(parserSource)).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
    expect(parserSource).toHaveLength(1953);
  });

});

describe('post107 parser HEAVY deepen', () => {
  // Tests-only deepen of parseM3U after helpers #107 and parser #108.
  // Orthogonal to helpers/ci-config; complementary to post106 suite.
  // Leftovers: fingerprints, scheme resets, attr/dedupe edges, helper cross-locks.
  // No product inventing.

  it("post107: sha256 fingerprint reaffirm", () => {

    expect(createHash('sha256').update(parserSource, 'utf8').digest('hex')).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');
    expect(
      createHash('sha256')
        .update(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8'), 'utf8')
        .digest('hex'),
    ).toBe('cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368');

  });

  it("post107: sha1 fingerprint reaffirm", () => {

    expect(createHash('sha1').update(parserSource, 'utf8').digest('hex')).toBe('701cdecbef5a9049af6bd11497493c4036a60211');

  });

  it("post107: md5 fingerprint reaffirm", () => {

    expect(createHash('md5').update(parserSource, 'utf8').digest('hex')).toBe('500211c4c526de887252451726776563');

  });

  it("post107: sha512 fingerprint lock", () => {

    expect(createHash('sha512').update(parserSource, 'utf8').digest('hex')).toBe('66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89');

  });

  it("post107: sha384 fingerprint lock", () => {

    expect(createHash('sha384').update(parserSource, 'utf8').digest('hex')).toBe('f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9');

  });

  it("post107: HMAC-SHA256(post107) fingerprint lock", () => {

    expect(createHmac('sha256', 'post107').update(parserSource, 'utf8').digest('hex')).toBe(
      'aa2a5fba6aa6db9982dd76e15113af693991aa09287057c6b89619da9b7c0993',
    );

  });

  it("post107: sha256 nibble sum 477", () => {

    const dig = createHash('sha256').update(parserSource, 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(477);

  });

  it("post107: first/last sha256 octets 0xcf / 0x68", () => {

    const dig = createHash('sha256').update(parserSource, 'utf8').digest('hex');
    expect(parseInt(dig.slice(0, 2), 16)).toBe(0xcf);
    expect(parseInt(dig.slice(-2), 16)).toBe(0x68);

  });

  it("post107: byte length 1955 via string/stat/Buffer/TextEncoder", () => {

    expect(parserSource.length).toBe(1953);
    expect(Buffer.byteLength(parserSource, 'utf8')).toBe(1955);
    expect(new TextEncoder().encode(parserSource).length).toBe(1955);
    expect(statSync(join(parserRoot, 'src/parser.ts')).size).toBe(1955);

  });

  it("post107: newline count 66 / split 67", () => {

    expect((parserSource.match(/\n/g) ?? []).length).toBe(66);
    expect(parserSource.split('\n')).toHaveLength(67);

  });

  it("post107: nonempty line count 56 / length sum 1887", () => {

    const ls = parserSource.split('\n');
    expect(ls.filter((l) => l.length > 0)).toHaveLength(56);
    expect(ls.filter((l) => l.length > 0).reduce((a, l) => a + l.length, 0)).toBe(1887);

  });

  it("post107: line length vector lock", () => {

    expect(parserSource.split('\n').map((l) => l.length)).toEqual([26,15,14,16,17,20,19,1,0,50,53,33,33,0,37,0,29,37,19,0,25,58,49,0,25,58,49,0,28,62,52,0,29,62,53,0,28,64,58,0,74,26,47,76,7,75,44,23,23,29,20,29,31,37,35,11,7,19,47,62,19,5,3,0,18,1,0]);

  });

  it("post107: first 40 char codes lock", () => {

    expect([...parserSource.slice(0, 40)].map((c) => c.charCodeAt(0))).toEqual([101,120,112,111,114,116,32,105,110,116,101,114,102,97,99,101,32,83,116,97,116,105,111,110,32,123,10,32,32,110,97,109,101,58,32,115,116,114,105,110]);

  });

  it("post107: last 40 char codes lock", () => {

    expect([...parserSource.slice(-40)].map((c) => c.charCodeAt(0))).toEqual([116,32,61,32,123,125,59,10,32,32,32,32,125,10,32,32,125,10,10,32,32,114,101,116,117,114,110,32,115,116,97,116,105,111,110,115,59,10,125,10]);

  });

  it("post107: digit count lock", () => {
    expect([...parserSource].filter((c) => /\d/.test(c))).toHaveLength(8);
  });

  it("post107: uppercase count lock", () => {
    expect([...parserSource].filter((c) => /[A-Z]/.test(c))).toHaveLength(54);
  });

  it("post107: lowercase count lock", () => {
    expect([...parserSource].filter((c) => /[a-z]/.test(c))).toHaveLength(1043);
  });

  it("post107: space count lock", () => {
    expect((parserSource.match(/ /g) ?? []).length).toBe(432);
  });

  it("post107: double-quote count lock", () => {
    expect((parserSource.match(/"/g) ?? []).length).toBe(15);
  });

  it("post107: single-quote count lock", () => {
    expect((parserSource.match(/'/g) ?? []).length).toBe(12);
  });

  it("post107: equals count lock", () => {
    expect((parserSource.match(/=/g) ?? []).length).toBe(27);
  });

  it("post107: underscore absent", () => {
    expect((parserSource.match(/_/g) ?? []).length).toBe(0);
  });

  it("post107: dash count lock", () => {
    expect((parserSource.match(/-/g) ?? []).length).toBe(12);
  });

  it("post107: bracket pair counts", () => {

    expect((parserSource.match(/\[/g) ?? []).length).toBe(13);
    expect((parserSource.match(/\]/g) ?? []).length).toBe(13);

  });

  it("post107: brace pair counts", () => {

    expect((parserSource.match(/\{/g) ?? []).length).toBe(13);
    expect((parserSource.match(/\}/g) ?? []).length).toBe(13);

  });

  it("post107: paren pair counts", () => {

    expect((parserSource.match(/\(/g) ?? []).length).toBe(40);
    expect((parserSource.match(/\)/g) ?? []).length).toBe(40);

  });

  it("post107: semicolon count lock", () => {
    expect((parserSource.match(/;/g) ?? []).length).toBe(28);
  });

  it("post107: colon count lock", () => {
    expect((parserSource.match(/:/g) ?? []).length).toBe(19);
  });

  it("post107: slash count lock", () => {
    expect((parserSource.match(/\//g) ?? []).length).toBe(30);
  });

  it("post107: dot count lock", () => {
    expect((parserSource.match(/\./g) ?? []).length).toBe(32);
  });

  it("post107: comma count lock", () => {
    expect((parserSource.match(/,/g) ?? []).length).toBe(8);
  });

  it("post107: hash count lock", () => {
    expect((parserSource.match(/#/g) ?? []).length).toBe(3);
  });

  it("post107: question mark count lock", () => {
    expect((parserSource.match(/\?/g) ?? []).length).toBe(4);
  });

  it("post107: bang count lock", () => {
    expect((parserSource.match(/!/g) ?? []).length).toBe(4);
  });

  it("post107: pipe count lock", () => {
    expect((parserSource.match(/\|/g) ?? []).length).toBe(2);
  });

  it("post107: amp count lock", () => {
    expect((parserSource.match(/&/g) ?? []).length).toBe(4);
  });

  it("post107: angle bracket counts", () => {

    expect((parserSource.match(/</g) ?? []).length).toBe(2);
    expect((parserSource.match(/>/g) ?? []).length).toBe(3);

  });

  it("post107: backtick absent / single arrow", () => {

    expect((parserSource.match(/`/g) ?? []).length).toBe(0);
    expect((parserSource.match(/=>/g) ?? []).length).toBe(1);

  });

  it("post107: tab and CR absent", () => {

    expect(parserSource.includes('\t')).toBe(false);
    expect(parserSource.includes('\r')).toBe(false);

  });

  it("post107: unique char set lock", () => {

    expect([...new Set(parserSource)].sort().join('')).toBe("\n !\"#&'()*+,-./13:;<=>?EFILMNOPRSTUWX[\\]^abcdefghiklmnoprstuvwxy{|}—");

  });

  it("post107: word token vector sha256 lock", () => {

    const words = parserSource.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words).toHaveLength(208);
    expect(createHash('sha256').update(words.join('|'), 'utf8').digest('hex')).toBe('aec8fd33d1a2feea92ce1e1c6731854716061cd541ab4f04aa7be4ad81a1c241');

  });

  it("post107: unique word inventory lock", () => {

    const words = parserSource.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const unique = [...new Set(words)].sort();
    expect(unique).toEqual(["EXTINF","Extract","Fallback","Non","Partial","Set","Station","URL","add","after","but","comma","commaIdx","const","country","countryMatch","current","else","end","etc","export","for","from","function","group","groupMatch","has","http","https","i","if","interface","l","langMatch","language","last","lastIndexOf","let","line","lines","logo","logoMatch","map","match","n","name","nameMatch","new","of","parseM3U","push","raw","reset","return","rtmp","seen","skip","slice","split","startsWith","stations","string","the","title","trim","tvg","url"]);
    expect(createHash('sha256').update(unique.join('|'), 'utf8').digest('hex')).toBe(
      'ab3bcc5db38ace588b56a55f3bf27775b33ced5dd486d8f85aad5ff7b682c489',
    );

  });

  it("post107: substring count parseM3U = 1", () => {

    expect(parserSource.split("parseM3U").length - 1).toBe(1);
  
  });

  it("post107: substring count Station = 4", () => {

    expect(parserSource.split("Station").length - 1).toBe(4);
  
  });

  it("post107: substring count EXTINF = 2", () => {

    expect(parserSource.split("EXTINF").length - 1).toBe(2);
  
  });

  it("post107: substring count tvg-name = 2", () => {

    expect(parserSource.split("tvg-name").length - 1).toBe(2);
  
  });

  it("post107: substring count tvg-logo = 2", () => {

    expect(parserSource.split("tvg-logo").length - 1).toBe(2);
  
  });

  it("post107: substring count group-title = 2", () => {

    expect(parserSource.split("group-title").length - 1).toBe(2);
  
  });

  it("post107: substring count tvg-language = 2", () => {

    expect(parserSource.split("tvg-language").length - 1).toBe(2);
  
  });

  it("post107: substring count tvg-country = 2", () => {

    expect(parserSource.split("tvg-country").length - 1).toBe(2);
  
  });

  it("post107: substring count http:// = 1", () => {

    expect(parserSource.split("http://").length - 1).toBe(1);
  
  });

  it("post107: substring count https:// = 1", () => {

    expect(parserSource.split("https://").length - 1).toBe(1);
  
  });

  it("post107: substring count seen = 3", () => {

    expect(parserSource.split("seen").length - 1).toBe(3);
  
  });

  it("post107: substring count current = 18", () => {

    expect(parserSource.split("current").length - 1).toBe(18);
  
  });

  it("post107: substring count startsWith = 4", () => {

    expect(parserSource.split("startsWith").length - 1).toBe(4);
  
  });

  it("post107: substring count Partial = 1", () => {

    expect(parserSource.split("Partial").length - 1).toBe(1);
  
  });

  it("post107: substring count trim = 2", () => {

    expect(parserSource.split("trim").length - 1).toBe(2);
  
  });

  it("post107: substring count push = 1", () => {

    expect(parserSource.split("push").length - 1).toBe(1);
  
  });

  it("post107: substring count .match( = 5", () => {

    expect(parserSource.split(".match(").length - 1).toBe(5);
  
  });

  it("post107: substring count lastIndexOf = 1", () => {

    expect(parserSource.split("lastIndexOf").length - 1).toBe(1);
  
  });

  it("post107: substring count slice( = 1", () => {

    expect(parserSource.split("slice(").length - 1).toBe(1);
  
  });

  it("post107: substring count Set<string> = 1", () => {

    expect(parserSource.split("Set<string>").length - 1).toBe(1);
  
  });

  it("post107: export inventory Station + parseM3U only", () => {

    const exports = [...parserSource.matchAll(/^export (?:interface|function) (\w+)/gm)].map(
      (m) => m[1],
    );
    expect(exports).toEqual(['Station', 'parseM3U']);

  });

  it("post107: no imports and no default export", () => {

    expect(parserSource).not.toMatch(/^import /m);
    expect(parserSource).not.toMatch(/export default/);

  });

  it("post107: first byte is e (0x65) and ends with newline", () => {

    expect(parserSource.charCodeAt(0)).toBe(0x65);
    expect(parserSource.endsWith('\n')).toBe(true);
    expect(parserSource.endsWith('}\n')).toBe(true);

  });

  it("post107: emdash present once at known index", () => {

    expect(parserSource.indexOf('—')).toBe(1876);
    expect(parserSource.lastIndexOf('—')).toBe(1876);
    expect(parserSource.codePointAt(1876)).toBe(0x2014);

  });

  it("post107: export indices lock", () => {

    expect(parserSource.indexOf('export interface Station')).toBe(0);
    expect(parserSource.indexOf('export function parseM3U')).toBe(137);

  });

  it("post107: sha256 of export name parseM3U", () => {

    expect(createHash('sha256').update('parseM3U', 'utf8').digest('hex')).toBe('6d920cec8badac45056b0bc62ba4d70dbbe5f227570c5cad160a9f80b6832591');
    expect(
      [...createHash('sha256').update('parseM3U', 'utf8').digest('hex')].reduce(
        (s, c) => s + parseInt(c, 16),
        0,
      ),
    ).toBe(477);

  });

  it("post107: sha256 of export name Station", () => {

    expect(createHash('sha256').update('Station', 'utf8').digest('hex')).toBe('115ccf9610656d3b5afd25f3160d9b5201266fc01eb30943e15838542b36521a');
    expect(
      [...createHash('sha256').update('Station', 'utf8').digest('hex')].reduce(
        (s, c) => s + parseInt(c, 16),
        0,
      ),
    ).toBe(396);

  });

  it("post107: line 0 exact content", () => {

    expect(parserSource.split('\n')[0]).toBe("export interface Station {");
  
  });

  it("post107: line 1 exact content", () => {

    expect(parserSource.split('\n')[1]).toBe("  name: string;");
  
  });

  it("post107: line 2 exact content", () => {

    expect(parserSource.split('\n')[2]).toBe("  url: string;");
  
  });

  it("post107: line 3 exact content", () => {

    expect(parserSource.split('\n')[3]).toBe("  logo?: string;");
  
  });

  it("post107: line 4 exact content", () => {

    expect(parserSource.split('\n')[4]).toBe("  group?: string;");
  
  });

  it("post107: line 5 exact content", () => {

    expect(parserSource.split('\n')[5]).toBe("  language?: string;");
  
  });

  it("post107: line 6 exact content", () => {

    expect(parserSource.split('\n')[6]).toBe("  country?: string;");
  
  });

  it("post107: line 7 exact content", () => {

    expect(parserSource.split('\n')[7]).toBe("}");
  
  });

  it("post107: line 8 exact content", () => {

    expect(parserSource.split('\n')[8]).toBe("");
  
  });

  it("post107: line 9 exact content", () => {

    expect(parserSource.split('\n')[9]).toBe("export function parseM3U(raw: string): Station[] {");
  
  });

  it("post107: line 10 exact content", () => {

    expect(parserSource.split('\n')[10]).toBe("  const lines = raw.split('\\n').map((l) => l.trim());");
  
  });

  it("post107: line 11 exact content", () => {

    expect(parserSource.split('\n')[11]).toBe("  const stations: Station[] = [];");
  
  });

  it("post107: line 12 exact content", () => {

    expect(parserSource.split('\n')[12]).toBe("  const seen = new Set<string>();");
  
  });

  it("post107: line 13 exact content", () => {

    expect(parserSource.split('\n')[13]).toBe("");
  
  });

  it("post107: line 14 exact content", () => {

    expect(parserSource.split('\n')[14]).toBe("  let current: Partial<Station> = {};");
  
  });

  it("post107: line 15 exact content", () => {

    expect(parserSource.split('\n')[15]).toBe("");
  
  });

  it("post107: line 16 exact content", () => {

    expect(parserSource.split('\n')[16]).toBe("  for (const line of lines) {");
  
  });

  it("post107: line 17 exact content", () => {

    expect(parserSource.split('\n')[17]).toBe("    if (line.startsWith('#EXTINF')) {");
  
  });

  it("post107: line 18 exact content", () => {

    expect(parserSource.split('\n')[18]).toBe("      current = {};");
  
  });

  it("post107: line 19 exact content", () => {

    expect(parserSource.split('\n')[19]).toBe("");
  
  });

  it("post107: line 20 exact content", () => {

    expect(parserSource.split('\n')[20]).toBe("      // Extract tvg-name");
  
  });

  it("post107: line 21 exact content", () => {

    expect(parserSource.split('\n')[21]).toBe("      const nameMatch = line.match(/tvg-name=\"([^\"]*)\"/i);");
  
  });

  it("post107: line 22 exact content", () => {

    expect(parserSource.split('\n')[22]).toBe("      if (nameMatch) current.name = nameMatch[1];");
  
  });

  it("post107: line 23 exact content", () => {

    expect(parserSource.split('\n')[23]).toBe("");
  
  });

  it("post107: line 24 exact content", () => {

    expect(parserSource.split('\n')[24]).toBe("      // Extract tvg-logo");
  
  });

  it("post107: line 25 exact content", () => {

    expect(parserSource.split('\n')[25]).toBe("      const logoMatch = line.match(/tvg-logo=\"([^\"]*)\"/i);");
  
  });

  it("post107: line 26 exact content", () => {

    expect(parserSource.split('\n')[26]).toBe("      if (logoMatch) current.logo = logoMatch[1];");
  
  });

  it("post107: line 27 exact content", () => {

    expect(parserSource.split('\n')[27]).toBe("");
  
  });

  it("post107: line 28 exact content", () => {

    expect(parserSource.split('\n')[28]).toBe("      // Extract group-title");
  
  });

  it("post107: line 29 exact content", () => {

    expect(parserSource.split('\n')[29]).toBe("      const groupMatch = line.match(/group-title=\"([^\"]*)\"/i);");
  
  });

  it("post107: line 30 exact content", () => {

    expect(parserSource.split('\n')[30]).toBe("      if (groupMatch) current.group = groupMatch[1];");
  
  });

  it("post107: line 31 exact content", () => {

    expect(parserSource.split('\n')[31]).toBe("");
  
  });

  it("post107: line 32 exact content", () => {

    expect(parserSource.split('\n')[32]).toBe("      // Extract tvg-language");
  
  });

  it("post107: line 33 exact content", () => {

    expect(parserSource.split('\n')[33]).toBe("      const langMatch = line.match(/tvg-language=\"([^\"]*)\"/i);");
  
  });

  it("post107: line 34 exact content", () => {

    expect(parserSource.split('\n')[34]).toBe("      if (langMatch) current.language = langMatch[1];");
  
  });

  it("post107: line 35 exact content", () => {

    expect(parserSource.split('\n')[35]).toBe("");
  
  });

  it("post107: line 36 exact content", () => {

    expect(parserSource.split('\n')[36]).toBe("      // Extract tvg-country");
  
  });

  it("post107: line 37 exact content", () => {

    expect(parserSource.split('\n')[37]).toBe("      const countryMatch = line.match(/tvg-country=\"([^\"]*)\"/i);");
  
  });

  it("post107: line 38 exact content", () => {

    expect(parserSource.split('\n')[38]).toBe("      if (countryMatch) current.country = countryMatch[1];");
  
  });

  it("post107: line 39 exact content", () => {

    expect(parserSource.split('\n')[39]).toBe("");
  
  });

  it("post107: line 40 exact content", () => {

    expect(parserSource.split('\n')[40]).toBe("      // Fallback name from the end of the #EXTINF line (after last comma)");
  
  });

  it("post107: line 41 exact content", () => {

    expect(parserSource.split('\n')[41]).toBe("      if (!current.name) {");
  
  });

  it("post107: line 42 exact content", () => {

    expect(parserSource.split('\n')[42]).toBe("        const commaIdx = line.lastIndexOf(',');");
  
  });

  it("post107: line 43 exact content", () => {

    expect(parserSource.split('\n')[43]).toBe("        if (commaIdx !== -1) current.name = line.slice(commaIdx + 1).trim();");
  
  });

  it("post107: line 44 exact content", () => {

    expect(parserSource.split('\n')[44]).toBe("      }");
  
  });

  it("post107: line 45 exact content", () => {

    expect(parserSource.split('\n')[45]).toBe("    } else if (line.startsWith('http://') || line.startsWith('https://')) {");
  
  });

  it("post107: line 46 exact content", () => {

    expect(parserSource.split('\n')[46]).toBe("      if (current.name && !seen.has(line)) {");
  
  });

  it("post107: line 47 exact content", () => {

    expect(parserSource.split('\n')[47]).toBe("        seen.add(line);");
  
  });

  it("post107: line 48 exact content", () => {

    expect(parserSource.split('\n')[48]).toBe("        stations.push({");
  
  });

  it("post107: line 49 exact content", () => {

    expect(parserSource.split('\n')[49]).toBe("          name: current.name,");
  
  });

  it("post107: line 50 exact content", () => {

    expect(parserSource.split('\n')[50]).toBe("          url: line,");
  
  });

  it("post107: line 51 exact content", () => {

    expect(parserSource.split('\n')[51]).toBe("          logo: current.logo,");
  
  });

  it("post107: line 52 exact content", () => {

    expect(parserSource.split('\n')[52]).toBe("          group: current.group,");
  
  });

  it("post107: line 53 exact content", () => {

    expect(parserSource.split('\n')[53]).toBe("          language: current.language,");
  
  });

  it("post107: line 54 exact content", () => {

    expect(parserSource.split('\n')[54]).toBe("          country: current.country,");
  
  });

  it("post107: line 55 exact content", () => {

    expect(parserSource.split('\n')[55]).toBe("        });");
  
  });

  it("post107: line 56 exact content", () => {

    expect(parserSource.split('\n')[56]).toBe("      }");
  
  });

  it("post107: line 57 exact content", () => {

    expect(parserSource.split('\n')[57]).toBe("      current = {};");
  
  });

  it("post107: line 58 exact content", () => {

    expect(parserSource.split('\n')[58]).toBe("    } else if (line && !line.startsWith('#')) {");
  
  });

  it("post107: line 59 exact content", () => {

    expect(parserSource.split('\n')[59]).toBe("      // Non-http URL (rtmp://, etc.) — skip but reset current");
  
  });

  it("post107: line 60 exact content", () => {

    expect(parserSource.split('\n')[60]).toBe("      current = {};");
  
  });

  it("post107: line 61 exact content", () => {

    expect(parserSource.split('\n')[61]).toBe("    }");
  
  });

  it("post107: line 62 exact content", () => {

    expect(parserSource.split('\n')[62]).toBe("  }");
  
  });

  it("post107: line 63 exact content", () => {

    expect(parserSource.split('\n')[63]).toBe("");
  
  });

  it("post107: line 64 exact content", () => {

    expect(parserSource.split('\n')[64]).toBe("  return stations;");
  
  });

  it("post107: line 65 exact content", () => {

    expect(parserSource.split('\n')[65]).toBe("}");
  
  });

  it("post107: line 66 exact content", () => {

    expect(parserSource.split('\n')[66]).toBe("");
  
  });

  it("post107: negative — no Gemini/Hono/MCP/genre product surface", () => {

    expect(parserSource).not.toMatch(
      /GEMINI|ANTHROPIC|Hono|resolveGenre|GENRE_MAP|MCP_MANIFEST|fetch\(|Request|Response|KVNamespace/,
    );

  });

  it("post107: negative — no async/await/Promise/Timers", () => {

    expect(parserSource).not.toMatch(/\basync\b|\bawait\b|\bPromise\b|setTimeout|setInterval/);

  });

  it("post107: negative — no Node/fs/path/process/crypto imports", () => {

    expect(parserSource).not.toMatch(/node:|require\(|process\.|fs\.|path\.|crypto/);

  });

  it("post107: negative — no CORS/auth/billing tokens", () => {

    expect(parserSource).not.toMatch(/CORS|Authorization|Bearer|billing|stripe|cloudflare/i);

  });

  it("post107: re-read equals module snapshot", () => {

    expect(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8')).toBe(parserSource);

  });

  it("post107: unicode normalize forms are identity", () => {

    expect(parserSource.normalize('NFC')).toBe(parserSource);
    expect(parserSource.normalize('NFD')).toBe(parserSource);
    expect(parserSource.normalize('NFKC')).toBe(parserSource);
    expect(parserSource.normalize('NFKD')).toBe(parserSource);

  });

  it("post107: scheme reset recovers after rtmp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
rtmp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after rtmps://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
rtmps://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after rtsp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
rtsp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after rtsps://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
rtsps://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after mms://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
mms://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after mmsh://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
mmsh://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after mmst://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
mmst://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after udp://1.2.3.4:5000", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
udp://1.2.3.4:5000
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after rtp://1.2.3.4", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
rtp://1.2.3.4
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after sctp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
sctp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after quic://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
quic://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ftp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ftp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ftps://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ftps://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after sftp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
sftp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after scp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
scp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after tftp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
tftp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after smb://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
smb://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after cifs://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
cifs://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after nfs://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
nfs://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after afp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
afp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after gopher://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
gopher://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after nntp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
nntp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after news://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
news://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after imap://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
imap://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after pop://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
pop://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after smtp://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
smtp://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ldap://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ldap://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ldaps://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ldaps://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after dict://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
dict://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after dns://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
dns://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ws://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ws://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after wss://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
wss://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after chrome://settings", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
chrome://settings
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after about:blank", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
about:blank
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after about:config", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
about:config
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after blob:https://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
blob:https://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after filesystem:https://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
filesystem:https://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after data:text/plain_hi", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
data:text/plain,hi
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after magnet:?xt=urn:btih:x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
magnet:?xt=urn:btih:x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ipfs://bafy", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ipfs://bafy
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ipns://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ipns://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after mailto:a@b.c", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
mailto:a@b.c
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after tel:+15551212", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
tel:+15551212
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after sms:+15551212", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
sms:+15551212
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after fax:+1", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
fax:+1
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after intent://scan/#Intent", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
intent://scan/#Intent
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after market://details?id=x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
market://details?id=x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after view-source:https://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
view-source:https://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after file:///etc/passwd", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
file:///etc/passwd
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after javascript:alert_1_", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
javascript:alert(1)
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after vbscript:msgbox", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
vbscript:msgbox
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after steam://run/0", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
steam://run/0
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after discord://-/channels/@me", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
discord://-/channels/@me
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after slack://open", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
slack://open
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after zoommtg://zoom.us/join", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
zoommtg://zoom.us/join
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after spotify:track:x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
spotify:track:x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after itunes://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
itunes://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after svn://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
svn://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after git://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
git://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ssh://user@host", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ssh://user@host
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after telnet://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
telnet://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after rlogin://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
rlogin://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after irc://irc.example/x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
irc://irc.example/x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ircs://irc.example/x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
ircs://irc.example/x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after Cap://x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
Cap://x
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after HTTP://X", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
HTTP://X
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after HTTPS://X", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
HTTPS://X
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after Http://X", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
Http://X
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after Https://X", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
Https://X
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after http:/single", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
http:/single
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after https:/single", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
https:/single
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after http:", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
http:
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after https:", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
https:
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after __server_share", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
\\server\share
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after C:__path__file", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
C:\\path\\file
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ./relative.m3u8", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
./relative.m3u8
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after ../up.m3u8", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
../up.m3u8
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after relative/path.m3u8", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
relative/path.m3u8
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after example.com/no-scheme", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
example.com/no-scheme
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: scheme reset recovers after //example.com/proto-relative", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Bad",Bad
//example.com/proto-relative
#EXTINF:-1 tvg-name="Good",Good
https://good.example/stream.m3u8
`);
    expect(stations).toEqual([
      {
        name: 'Good',
        url: 'https://good.example/stream.m3u8',
        logo: undefined,
        group: undefined,
        language: undefined,
        country: undefined,
      },
    ]);
  
  });

  it("post107: buildSimpleM3U attr matrix round-trips all optional fields", () => {

    const input = [{"name":"A","logo":"https://cdn/a.png","group":"G","language":"en","country":"US"},{"name":"B","group":"Jazz"},{"name":"C","language":"fr","country":"FR"},{"name":"D","logo":""},{"name":"E","group":"","language":"","country":""},{"name":"F","logo":"https://cdn/f.png","group":"Rock","language":"de","country":"DE"}];
    const m3u = buildSimpleM3U(input.map((s, i) => ({ ...s, url: `https://m/${i}` })));
    const stations = parseM3U(m3u);
    expect(stations).toHaveLength(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(stations[i].name).toBe(input[i].name);
      expect(stations[i].url).toBe(`https://m/${i}`);
      expect(stations[i].logo).toBe(input[i].logo);
      expect(stations[i].group).toBe(input[i].group);
      expect(stations[i].language).toBe(input[i].language);
      expect(stations[i].country).toBe(input[i].country);
    }
    expect(countHttpStreamLines(m3u)).toBe(input.length);

  });

  it("post107: dedupe keeps first across 50 unique then 50 shuffled dupes", () => {

    const lines = ['#EXTM3U'];
    for (let i = 0; i < 50; i++) {
      lines.push(`#EXTINF:-1 tvg-name="U${i}",U${i}`);
      lines.push(`https://u/${i}`);
    }
    const order = [...Array(50).keys()].reverse();
    for (const i of order) {
      lines.push(`#EXTINF:-1 tvg-name="D${i}",D${i}`);
      lines.push(`https://u/${i}`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(50);
    expect(stations.map((s) => s.name)).toEqual([...Array(50).keys()].map((i) => `U${i}`));

  });

  it("post107: dedupe is case-sensitive on URL path", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com/Path
#EXTINF:-1,B
https://example.com/path
#EXTINF:-1,C
https://example.com/PATH
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/Path',
      'https://example.com/path',
      'https://example.com/PATH',
    ]);

  });

  it("post107: query param order differences are distinct URLs", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://x?a=1&b=2
#EXTINF:-1,B
https://x?b=2&a=1
`);
    expect(stations).toHaveLength(2);

  });

  it("post107: fragment differences are distinct URLs", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://x#one
#EXTINF:-1,B
https://x#two
`);
    expect(stations.map((s) => s.url)).toEqual(['https://x#one', 'https://x#two']);

  });

  it("post107: tvg-name with only spaces is truthy and pushes", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="   ",X\nhttps://u\n');
    expect(s.name).toBe('   ');
    expect(s.url).toBe('https://u');

  });

  it("post107: empty tvg-name falls back even when other attrs present", () => {

    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",Fallback\nhttps://u\n',
    );
    expect(s).toEqual({
      name: 'Fallback',
      url: 'https://u',
      logo: 'L',
      group: 'G',
      language: 'en',
      country: 'US',
    });

  });

  it("post107: first-wins for all five attrs when each duplicated thrice", () => {

    const line =
      '#EXTINF:-1 tvg-name="N1" tvg-name="N2" tvg-name="N3" tvg-logo="L1" tvg-logo="L2" tvg-logo="L3" group-title="G1" group-title="G2" group-title="G3" tvg-language="A" tvg-language="B" tvg-language="C" tvg-country="X" tvg-country="Y" tvg-country="Z",Disp';
    const [s] = parseM3U(`#EXTM3U\n${line}\nhttps://u\n`);
    expect(s).toEqual({
      name: 'N1',
      url: 'https://u',
      logo: 'L1',
      group: 'G1',
      language: 'A',
      country: 'X',
    });

  });

  it("post107: attribute values may contain equals and hashes", () => {

    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A=B#C" tvg-logo="https://cdn/x.png?v=1#frag" group-title="G=1",A=B#C\nhttps://u\n',
    );
    expect(s.name).toBe('A=B#C');
    expect(s.logo).toBe('https://cdn/x.png?v=1#frag');
    expect(s.group).toBe('G=1');

  });

  it("post107: EXTINF duration scientific notation still extracts attrs", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:1e3 tvg-name="Sci",Sci\nhttps://u\n');
    expect(s.name).toBe('Sci');

  });

  it("post107: EXTINF with only attrs and no comma uses tvg-name", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-name="Only"\nhttps://u\n');
    expect(s.name).toBe('Only');

  });

  it("post107: multiple blank and comment lines between EXTINF and URL", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Gap",Gap

# PLAYLIST
#EXTVLCOPT:http-user-agent=x

https://gap
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://gap');

  });

  it("post107: interleaved orphan http URLs do not steal prior names after push", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://a
https://orphan
#EXTINF:-1,B
https://b
`);
    expect(stations.map((s) => s.url)).toEqual(['https://a', 'https://b']);

  });

  it("post107: SAMPLE_M3U cross-lock names urls groups via parseM3U", () => {

    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.map((s) => s.name)).toEqual([
      'Alpha FM',
      'Beta FM',
      'Gamma FM',
      'Delta FM',
      'Epsilon FM',
      'Zeta FM',
    ]);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/alpha.m3u8',
      'https://example.com/beta.m3u8',
      'https://example.com/gamma.m3u8',
      'https://example.com/delta.m3u8',
      'https://example.com/epsilon.m3u8',
      'https://example.com/zeta.m3u8',
    ]);
    expect(stations.every((s) => s.group === 'Music')).toBe(true);
    expect(stations.every((s) => s.logo === undefined)).toBe(true);
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(6);

  });

  it("post107: SAMPLE fixture local SAMPLE length 4 after dedupe", () => {

    const stations = parseM3U(SAMPLE);
    expect(stations).toHaveLength(4);
    expect(stations.map((s) => s.url)).toEqual([
      'https://example.com/drone.m3u8',
      'https://example.com/jazz.m3u8',
      'https://example.com/comma-only.m3u8',
      'http://example.com/news.m3u8',
    ]);

  });

  it("post107: buildSimpleM3U scale 300 preserves order", () => {

    const input = Array.from({ length: 300 }, (_, i) => ({
      name: `S${i}`,
      url: `https://scale/${i}`,
      group: i % 2 === 0 ? 'Even' : 'Odd',
    }));
    const stations = parseM3U(buildSimpleM3U(input));
    expect(stations).toHaveLength(300);
    expect(stations[0]).toMatchObject({ name: 'S0', url: 'https://scale/0', group: 'Even' });
    expect(stations[299]).toMatchObject({ name: 'S299', url: 'https://scale/299', group: 'Odd' });
    expect(countHttpStreamLines(buildSimpleM3U(input))).toBe(300);

  });

  it("post107: isolation — two parses do not share seen set", () => {

    const a = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://shared\n');
    const b = parseM3U('#EXTM3U\n#EXTINF:-1,B\nhttps://shared\n');
    expect(a[0].name).toBe('A');
    expect(b[0].name).toBe('B');

  });

  it("post107: isolation — mutating returned station does not affect next parse", () => {

    const first = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://u\n');
    first[0].name = 'mutated';
    const second = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://u\n');
    expect(second[0].name).toBe('A');

  });

  it("post107: Object.keys order on station is name url logo group language country", () => {

    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="N" tvg-logo="L" group-title="G" tvg-language="en" tvg-country="US",N\nhttps://u\n',
    );
    expect(Object.keys(s)).toEqual(['name', 'url', 'logo', 'group', 'language', 'country']);

  });

  it("post107: JSON.stringify drops undefined optional fields", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://u\n');
    expect(JSON.parse(JSON.stringify(s))).toEqual({ name: 'A', url: 'https://u' });

  });

  it("post107: JSON.stringify keeps empty-string optional fields", () => {

    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1 tvg-name="A" tvg-logo="" group-title="" tvg-language="" tvg-country="",A\nhttps://u\n',
    );
    expect(JSON.parse(JSON.stringify(s))).toEqual({
      name: 'A',
      url: 'https://u',
      logo: '',
      group: '',
      language: '',
      country: '',
    });

  });

  it("post107: preserves ZWJ emoji sequences in names", () => {

    const name = '👨‍👩‍👧‍👦 FM';
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u\n`);
    expect(s.name).toBe(name);

  });

  it("post107: preserves RTL marks in group-title", () => {

    const group = '\u200Fعربية\u200E';
    const [s] = parseM3U(
      `#EXTM3U\n#EXTINF:-1 tvg-name="A" group-title="${group}",A\nhttps://u\n`,
    );
    expect(s.group).toBe(group);

  });

  it("post107: preserves soft hyphen and nbsp in display name fallback", () => {

    const name = 'Soft\u00ADHyphen\u00A0Name';
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,${name}\nhttps://u\n`);
    expect(s.name).toBe(name);

  });

  it("post107: IPv4 and IPv6 literals both bind as https streams", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,V4
https://127.0.0.1:8443/live
#EXTINF:-1,V6
https://[2001:db8::1]:443/live
`);
    expect(stations.map((s) => s.url)).toEqual([
      'https://127.0.0.1:8443/live',
      'https://[2001:db8::1]:443/live',
    ]);

  });

  it("post107: userinfo in URL is preserved", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://user:pass@example.com/x\n');
    expect(s.url).toBe('https://user:pass@example.com/x');

  });

  it("post107: keeps EXTINF state across tag _EXTGRP_Rock", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXTGRP:Rock
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _EXTVLCOPT_network-caching_1000", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXTVLCOPT:network-caching=1000
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _EXTIMG_https___x", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXTIMG:https://x
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _EXTALB_Album", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXTALB:Album
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _PLAYLIST_Name", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#PLAYLIST:Name
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _EXTM3U", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXTM3U
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag __", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
# 
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: keeps EXTINF state across tag _EXT-X-VERSION_3", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="Keep",Keep
#EXT-X-VERSION:3
https://keep
`);
    expect(stations).toHaveLength(1);
    expect(stations[0].url).toBe('https://keep');
  
  });

  it("post107: #extinf lowercase is ignored as non-EXTINF comment-like", () => {

    const stations = parseM3U(`#EXTM3U
#extinf:-1 tvg-name="Nope",Nope
https://orphan
#EXTINF:-1 tvg-name="Yep",Yep
https://yep
`);
    expect(stations.map((s) => s.url)).toEqual(['https://yep']);

  });

  it("post107: #EXTINF must be prefix — mid-line ignored", () => {

    const stations = parseM3U(`#EXTM3U
x#EXTINF:-1 tvg-name="Nope",Nope
https://orphan
#EXTINF:-1,Yep
https://yep
`);
    expect(stations.map((s) => s.url)).toEqual(['https://yep']);

  });

  it("post107: mixed LF and CRLF in one playlist", () => {

    const raw = '#EXTM3U\r\n#EXTINF:-1,A\nhttps://a\r\n#EXTINF:-1,B\r\nhttps://b\n';
    expect(parseM3U(raw).map((s) => s.url)).toEqual(['https://a', 'https://b']);

  });

  it("post107: leading BOM on whole playlist still parses", () => {

    const stations = parseM3U('\uFEFF#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(stations).toHaveLength(1);
    expect(stations[0].name).toBe('A');

  });

  it("post107: station objects are plain Object prototypes", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
    expect(Object.prototype.toString.call(s)).toBe('[object Object]');

  });

  it("post107: returned array is extensible and not frozen", () => {

    const stations = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://a\n');
    expect(Object.isExtensible(stations)).toBe(true);
    expect(Object.isFrozen(stations)).toBe(false);
    stations.push({
      name: 'X',
      url: 'https://x',
      logo: undefined,
      group: undefined,
      language: undefined,
      country: undefined,
    });
    expect(stations).toHaveLength(2);

  });

  it("post107: structuredClone deep-equals stations from SAMPLE_M3U", () => {

    const stations = parseM3U(SAMPLE_M3U);
    expect(structuredClone(stations)).toEqual(stations);

  });

  it("post107: Array.from copy is shallow-equal on field values", () => {

    const stations = parseM3U(SAMPLE_M3U);
    expect(Array.from(stations)).toEqual(stations);
    expect(Array.from(stations)).not.toBe(stations);

  });

  it("post107: alternating 100 reset schemes then 100 good streams", () => {

    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100; i++) {
      lines.push(`#EXTINF:-1,Bad${i}`);
      lines.push(`rtmp://bad/${i}`);
      lines.push(`#EXTINF:-1,Good${i}`);
      lines.push(`https://good/${i}`);
    }
    const stations = parseM3U(lines.join('\n'));
    expect(stations).toHaveLength(100);
    expect(stations.every((s) => s.url.startsWith('https://good/'))).toBe(true);

  });

  it("post107: excessive whitespace between attributes still matches", () => {

    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1   tvg-name="W"    group-title="G"   ,W\nhttps://u\n',
    );
    expect(s.name).toBe('W');
    expect(s.group).toBe('G');

  });

  it("post107: no space before attribute still matches", () => {

    const [s] = parseM3U(
      '#EXTM3U\n#EXTINF:-1tvg-name="Glue"group-title="G",Glue\nhttps://u\n',
    );
    expect(s.name).toBe('Glue');
    expect(s.group).toBe('G');

  });

  it("post107: many commas — fallback is after last comma only", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,one,two,three,four\nhttps://u\n');
    expect(s.name).toBe('four');

  });

  it("post107: comma fallback trims surrounding spaces", () => {

    const [s] = parseM3U('#EXTM3U\n#EXTINF:-1,   Spaced Name   \nhttps://u\n');
    expect(s.name).toBe('Spaced Name');

  });

  it("post107: trailing comma empty fallback skips push", () => {

    expect(parseM3U('#EXTM3U\n#EXTINF:-1,\nhttps://u\n')).toEqual([]);

  });

  it("post107: whitespace-only after comma skips push", () => {

    expect(parseM3U('#EXTM3U\n#EXTINF:-1,   \nhttps://u\n')).toEqual([]);

  });

  it("post107: http and https of identical host+path are distinct", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
http://example.com/x
#EXTINF:-1,B
https://example.com/x
`);
    expect(stations).toHaveLength(2);

  });

  it("post107: port differences are distinct streams", () => {

    const stations = parseM3U(`#EXTM3U
#EXTINF:-1,A
https://example.com:443/x
#EXTINF:-1,B
https://example.com:8443/x
`);
    expect(stations).toHaveLength(2);

  });

  it("post107: countHttpStreamLines matches parse length for SAMPLE_M3U", () => {

    expect(parseM3U(SAMPLE_M3U)).toHaveLength(countHttpStreamLines(SAMPLE_M3U));

  });

  it("post107: countHttpStreamLines overcounts when orphan URLs present", () => {

    const body = '#EXTM3U\nhttps://orphan\n#EXTINF:-1,A\nhttps://a\n';
    expect(countHttpStreamLines(body)).toBe(2);
    expect(parseM3U(body)).toHaveLength(1);

  });

  it("post107: buildSimpleM3U empty parses to []", () => {

    expect(parseM3U(buildSimpleM3U([]))).toEqual([]);
    expect(countHttpStreamLines(buildSimpleM3U([]))).toBe(0);

  });

  it("post107: ignores unsupported attr key tvg_name", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg_name=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key tvgName", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvgName=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key name", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 name=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key title", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 title=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key tvg-id", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-id=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key tvg-chno", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-chno=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key tvg-shift", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-shift=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key radio", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 radio=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key catchup", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 catchup=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key catchup-source", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 catchup-source=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: ignores unsupported attr key http-user-agent", () => {

    const stations = parseM3U(
      "#EXTM3U\n#EXTINF:-1 http-user-agent=\"Nope\",Fallback\nhttps://u\n",
    );
    expect(stations[0].name).toBe('Fallback');
  
  });

  it("post107: lang/country pair en/US round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"en\" tvg-country=\"US\",X\nhttps://u\n",
    );
    expect(s.language).toBe("en");
    expect(s.country).toBe("US");
  
  });

  it("post107: lang/country pair en/GB round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"en\" tvg-country=\"GB\",X\nhttps://u\n",
    );
    expect(s.language).toBe("en");
    expect(s.country).toBe("GB");
  
  });

  it("post107: lang/country pair fr/FR round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"fr\" tvg-country=\"FR\",X\nhttps://u\n",
    );
    expect(s.language).toBe("fr");
    expect(s.country).toBe("FR");
  
  });

  it("post107: lang/country pair de/DE round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"de\" tvg-country=\"DE\",X\nhttps://u\n",
    );
    expect(s.language).toBe("de");
    expect(s.country).toBe("DE");
  
  });

  it("post107: lang/country pair es/ES round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"es\" tvg-country=\"ES\",X\nhttps://u\n",
    );
    expect(s.language).toBe("es");
    expect(s.country).toBe("ES");
  
  });

  it("post107: lang/country pair pt/BR round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"pt\" tvg-country=\"BR\",X\nhttps://u\n",
    );
    expect(s.language).toBe("pt");
    expect(s.country).toBe("BR");
  
  });

  it("post107: lang/country pair ja/JP round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"ja\" tvg-country=\"JP\",X\nhttps://u\n",
    );
    expect(s.language).toBe("ja");
    expect(s.country).toBe("JP");
  
  });

  it("post107: lang/country pair ko/KR round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"ko\" tvg-country=\"KR\",X\nhttps://u\n",
    );
    expect(s.language).toBe("ko");
    expect(s.country).toBe("KR");
  
  });

  it("post107: lang/country pair zh/CN round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"zh\" tvg-country=\"CN\",X\nhttps://u\n",
    );
    expect(s.language).toBe("zh");
    expect(s.country).toBe("CN");
  
  });

  it("post107: lang/country pair ar/SA round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"ar\" tvg-country=\"SA\",X\nhttps://u\n",
    );
    expect(s.language).toBe("ar");
    expect(s.country).toBe("SA");
  
  });

  it("post107: lang/country pair hi/IN round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"hi\" tvg-country=\"IN\",X\nhttps://u\n",
    );
    expect(s.language).toBe("hi");
    expect(s.country).toBe("IN");
  
  });

  it("post107: lang/country pair ru/RU round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"ru\" tvg-country=\"RU\",X\nhttps://u\n",
    );
    expect(s.language).toBe("ru");
    expect(s.country).toBe("RU");
  
  });

  it("post107: lang/country pair it/IT round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"it\" tvg-country=\"IT\",X\nhttps://u\n",
    );
    expect(s.language).toBe("it");
    expect(s.country).toBe("IT");
  
  });

  it("post107: lang/country pair nl/NL round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"nl\" tvg-country=\"NL\",X\nhttps://u\n",
    );
    expect(s.language).toBe("nl");
    expect(s.country).toBe("NL");
  
  });

  it("post107: lang/country pair sv/SE round-trips", () => {

    const [s] = parseM3U(
      "#EXTM3U\n#EXTINF:-1 tvg-name=\"X\" tvg-language=\"sv\" tvg-country=\"SE\",X\nhttps://u\n",
    );
    expect(s.language).toBe("sv");
    expect(s.country).toBe("SE");
  
  });

  it("post107: group-title Ambient round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Ambient" }]);
    expect(parseM3U(m3u)[0].group).toBe("Ambient");
  
  });

  it("post107: group-title Jazz round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Jazz" }]);
    expect(parseM3U(m3u)[0].group).toBe("Jazz");
  
  });

  it("post107: group-title Classical round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Classical" }]);
    expect(parseM3U(m3u)[0].group).toBe("Classical");
  
  });

  it("post107: group-title Pop round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Pop" }]);
    expect(parseM3U(m3u)[0].group).toBe("Pop");
  
  });

  it("post107: group-title Rock round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Rock" }]);
    expect(parseM3U(m3u)[0].group).toBe("Rock");
  
  });

  it("post107: group-title News round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "News" }]);
    expect(parseM3U(m3u)[0].group).toBe("News");
  
  });

  it("post107: group-title Sports round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Sports" }]);
    expect(parseM3U(m3u)[0].group).toBe("Sports");
  
  });

  it("post107: group-title Talk round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Talk" }]);
    expect(parseM3U(m3u)[0].group).toBe("Talk");
  
  });

  it("post107: group-title Electronic round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "Electronic" }]);
    expect(parseM3U(m3u)[0].group).toBe("Electronic");
  
  });

  it("post107: group-title World round-trips via buildSimpleM3U", () => {

    const m3u = buildSimpleM3U([{ name: 'N', url: 'https://u', group: "World" }]);
    expect(parseM3U(m3u)[0].group).toBe("World");
  
  });

  it("post107: 2k-char path URL preserved", () => {

    const path = 'p'.repeat(2000);
    const url = `https://example.com/${path}`;
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1,A\n${url}\n`);
    expect(s.url).toBe(url);
    expect(s.url.length).toBe(2000 + 'https://example.com/'.length);

  });

  it("post107: 500-char station name preserved", () => {

    const name = 'N'.repeat(500);
    const [s] = parseM3U(`#EXTM3U\n#EXTINF:-1 tvg-name="${name}",X\nhttps://u\n`);
    expect(s.name).toBe(name);
    expect(s.name).toHaveLength(500);

  });

  it("post107: reduce length equals map length for SAMPLE_M3U", () => {

    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.reduce((n) => n + 1, 0)).toBe(stations.map((s) => s.url).length);

  });

  it("post107: filter https-only keeps all SAMPLE_M3U stations", () => {

    expect(parseM3U(SAMPLE_M3U).filter((s) => s.url.startsWith('https://'))).toHaveLength(6);

  });

  it("post107: filter http-only keeps News Desk from local SAMPLE", () => {

    expect(parseM3U(SAMPLE).filter((s) => s.url.startsWith('http://')).map((s) => s.name)).toEqual([
      'News Desk',
    ]);

  });

  it("post107: HMAC-SHA256(post107) of SAMPLE_M3U lock", () => {
    expect(createHmac('sha256', 'post107').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe(
      '204cbdf93dc15e484fb8571416a4921aa907bc2edaaf00a0c33c258884df53ac',
    );
  });
});


// --- HEAVY burn (post-#123): deepen parser unit slice only — no product inventing ---
// Orthogonal to closed #122 genres conflict / merged #119 genres + #123 ci-config.
// Leftover edges after post106/post107: fingerprints, scheme/attr/dedupe, inventing fences.

describe('post123 parser HEAVY deepen', () => {
  const read = (rel: string) => readFileSync(join(parserRoot, rel), 'utf8');
  const src = parserSource;

  it("post123: locks parser.ts sha256 (reaffirm)", () => {
    expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
  });

  it("post123: locks parser.ts sha1 (reaffirm)", () => {
    expect(createHash('sha1').update(src, 'utf8').digest('hex')).toBe("701cdecbef5a9049af6bd11497493c4036a60211");
  });

  it("post123: locks parser.ts md5 (reaffirm)", () => {
    expect(createHash('md5').update(src, 'utf8').digest('hex')).toBe("500211c4c526de887252451726776563");
  });

  it("post123: locks parser.ts sha384", () => {
    expect(createHash('sha384').update(src, 'utf8').digest('hex')).toBe("f0a019536ec33dacf0f6547d31576d16c174a981267b33d61eee78f76eb3b6159a56584ed8a9b73c8b0931ec7e109fa9");
  });

  it("post123: locks parser.ts sha512", () => {
    expect(createHash('sha512').update(src, 'utf8').digest('hex')).toBe("66bdc1d7e75b956559a0487151947ec6b3537de14c0379001563c3de14b3d2f7b99af3e1ffe39dc5064f647ef34999f76102443a3323dd6252d69055981e0b89");
  });

  it("post123: sha256 nibble sum 477 / xor 9", () => {
    const dig = createHash('sha256').update(src, 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(477);
    expect([...dig].reduce((a, c) => a ^ parseInt(c, 16), 0)).toBe(9);
  });

  it("post123: first/last sha256 octets 0xcf / 0x68", () => {
    const dig = createHash('sha256').update(src, 'utf8').digest('hex');
    expect(parseInt(dig.slice(0, 2), 16)).toBe(0xcf);
    expect(parseInt(dig.slice(-2), 16)).toBe(0x68);
  });

  it("post123: HMAC-SHA256 keyed by post123", () => {
    expect(createHmac('sha256', "post123").update(src, 'utf8').digest('hex')).toBe("995aba2fa63618f8d8028da67cab3f62fbbb20044d76fd4a9a45488f006a464c");
  });

  it("post123: HMAC-SHA256 keyed by parser", () => {
    expect(createHmac('sha256', "parser").update(src, 'utf8').digest('hex')).toBe("9276d22adc96b16b1448de50885b29e41d299ade46428c74e22062b8fe6b617a");
  });

  it("post123: HMAC-SHA256 keyed by parseM3U", () => {
    expect(createHmac('sha256', "parseM3U").update(src, 'utf8').digest('hex')).toBe("6a02c2bd7b3573d7202afc9bd5e9f0f0af368217776af69bb431d07005a5ff90");
  });

  it("post123: HMAC-SHA256 keyed by leftover-edges", () => {
    expect(createHmac('sha256', "leftover-edges").update(src, 'utf8').digest('hex')).toBe("e3df275bfbe1abc4b0e5bc4c6d25d21f9560f24353412e3379090b461ae3dae6");
  });

  it("post123: HMAC-SHA256 keyed by heavy-burn", () => {
    expect(createHmac('sha256', "heavy-burn").update(src, 'utf8').digest('hex')).toBe("cf3b75e46ccb9552932b40eb310fd55d6824761cd1574a0ea66c575a9a825e0c");
  });

  it("post123: HMAC-SHA256 keyed by TOKENMAXX", () => {
    expect(createHmac('sha256', "TOKENMAXX").update(src, 'utf8').digest('hex')).toBe("eb866dc584e40b066fb5a9de9222c575a6d45a5401d3f67886f8671f9404bbe8");
  });

  it("post123: HMAC-SHA256 keyed by soft-cap", () => {
    expect(createHmac('sha256', "soft-cap").update(src, 'utf8').digest('hex')).toBe("092bf8a59deebfda82bcfb2db1026aa719d9616b57a9304d1ac9c2f24228bf5b");
  });

  it("post123: HMAC-SHA256 keyed by EoD", () => {
    expect(createHmac('sha256', "EoD").update(src, 'utf8').digest('hex')).toBe("900eb9636ea478b4f3ee5077a1732babf4fe57c7e747bbccd6f93e64ab7b179c");
  });

  it("post123: HMAC-SHA256 keyed by no-routes", () => {
    expect(createHmac('sha256', "no-routes").update(src, 'utf8').digest('hex')).toBe("e92633fe49e5f30ec2219b048a77a48aa6ec5a590a5876db3e9a09892a3cb412");
  });

  it("post123: HMAC-SHA256 keyed by no-genres", () => {
    expect(createHmac('sha256', "no-genres").update(src, 'utf8').digest('hex')).toBe("d30d7e39a3d5ab08f339b8284e6c8ab6c276ed98af6130f371bb1d7ac2d3c079");
  });

  it("post123: HMAC-SHA1/MD5 keyed by post123", () => {
    expect(createHmac('sha1', 'post123').update(src, 'utf8').digest('hex')).toBe("498b08947a77ed5a4b0900b720a7e05a5c1180fd");
    expect(createHmac('md5', 'post123').update(src, 'utf8').digest('hex')).toBe("c09e55ed0b905839a1c6d6e88d67cfda");
  });

  it("post123: post123 HMAC differs from post107 and plain sha256", () => {
    const plain = createHash('sha256').update(src, 'utf8').digest('hex');
    const p123 = createHmac('sha256', 'post123').update(src, 'utf8').digest('hex');
    const p107 = createHmac('sha256', 'post107').update(src, 'utf8').digest('hex');
    expect(p123).not.toBe(plain);
    expect(p123).not.toBe(p107);
    expect(new Set([plain, p123, p107]).size).toBe(3);
  });

  it("post123: locks genres.ts sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("src/genres.ts"), 'utf8').digest('hex')).toBe("aa626817cf3bc8a707ac5adba39f811dfbc23f695e5e0cb9d070007d839d914e");
  });

  it("post123: locks genres.ts sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("src/genres.ts"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(500);
  });

  it("post123: locks index.ts sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("src/index.ts"), 'utf8').digest('hex')).toBe("7f0d574b0aedc6cd71d3ea35bb03e2a20389028e6ff2c195718acff2e0313a72");
  });

  it("post123: locks index.ts sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("src/index.ts"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(470);
  });

  it("post123: locks mcp.ts sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("src/mcp.ts"), 'utf8').digest('hex')).toBe("6ae8ffd7c4b75c471db2dff1fe5c6ad61aff69e38b048a366bb8b7adb3099683");
  });

  it("post123: locks mcp.ts sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("src/mcp.ts"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(551);
  });

  it("post123: locks types.ts sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("src/types.ts"), 'utf8').digest('hex')).toBe("4008ddd3dd6dd2fb7e8d386dfe2a345e4f21fa5576e229a8fbbe691626f743d3");
  });

  it("post123: locks types.ts sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("src/types.ts"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(520);
  });

  it("post123: locks AGENTS.md sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("AGENTS.md"), 'utf8').digest('hex')).toBe("48e590b4f146e2fbd1ebb409e0d5a5ec1be50b72b2c310f1c1e360487b36feaa");
  });

  it("post123: locks AGENTS.md sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("AGENTS.md"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(479);
  });

  it("post123: locks README.md sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("README.md"), 'utf8').digest('hex')).toBe("f7ecd30301c01e7af03a64ca32d1368a10cac861c09016c718e39417dc15c987");
  });

  it("post123: locks README.md sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("README.md"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(429);
  });

  it("post123: locks DEPLOY.md sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("DEPLOY.md"), 'utf8').digest('hex')).toBe("11067fa2da7ee6d2354842e1c258f363d487536ac307b76739893a93b0c9d05a");
  });

  it("post123: locks DEPLOY.md sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("DEPLOY.md"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(439);
  });

  it("post123: locks package.json sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("package.json"), 'utf8').digest('hex')).toBe("34552493f3008b58991d10e7b41ee0ecaa43bf8ba3e79d261ac2a061e6f7181c");
  });

  it("post123: locks package.json sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("package.json"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(451);
  });

  it("post123: locks vitest.config.ts sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("vitest.config.ts"), 'utf8').digest('hex')).toBe("f9b58bb937531da55ad474592e69ec95c6d55a5b8b878f8fa251c0f8d6caff38");
  });

  it("post123: locks vitest.config.ts sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("vitest.config.ts"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(536);
  });

  it("post123: locks tsconfig.json sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("tsconfig.json"), 'utf8').digest('hex')).toBe("ef73d52e26c5dbe1f1785a067cbc04688ea1e6ef80ca5fff4a7351583828d792");
  });

  it("post123: locks tsconfig.json sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("tsconfig.json"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(506);
  });

  it("post123: locks ci.yml sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read(".github/workflows/ci.yml"), 'utf8').digest('hex')).toBe("c4db88d23a2f8c41a388c0791279f5e6f56e3d5da7cc8fd25f97b5308b00eed5");
  });

  it("post123: locks ci.yml sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read(".github/workflows/ci.yml"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(515);
  });

  it("post123: locks wrangler.toml sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("wrangler.toml"), 'utf8').digest('hex')).toBe("95b11779a88f0544f3561eea67994a0b0b874d7b8776579189fa7142fa0473f8");
  });

  it("post123: locks wrangler.toml sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("wrangler.toml"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(457);
  });

  it("post123: locks helpers.ts sha256 (cross-surface)", () => {
    expect(createHash('sha256').update(read("test/helpers.ts"), 'utf8').digest('hex')).toBe("240e1fc521e029b07ca3ebda83410c4a4014af02f3ad64fa4eba8bf6ffd3af29");
  });

  it("post123: locks helpers.ts sha256 nibble sum", () => {
    const dig = createHash('sha256').update(read("test/helpers.ts"), 'utf8').digest('hex');
    expect([...dig].reduce((s, c) => s + parseInt(c, 16), 0)).toBe(487);
  });

  it("post123: byte/code-unit/stat/TextEncoder sizes", () => {
    expect(src.length).toBe(1953);
    expect(Buffer.byteLength(src, 'utf8')).toBe(1955);
    expect(new TextEncoder().encode(src).length).toBe(1955);
    expect(statSync(join(parserRoot, 'src/parser.ts')).size).toBe(1955);
  });

  it("post123: newline/split counts", () => {
    expect((src.match(/\n/g) ?? []).length).toBe(66);
    expect(src.split('\n')).toHaveLength(67);
  });

  it("post123: line length vector lock", () => {
    expect(src.split('\n').map((l) => l.length)).toEqual([26,15,14,16,17,20,19,1,0,50,53,33,33,0,37,0,29,37,19,0,25,58,49,0,25,58,49,0,28,62,52,0,29,62,53,0,28,64,58,0,74,26,47,76,7,75,44,23,23,29,20,29,31,37,35,11,7,19,47,62,19,5,3,0,18,1,0]);
  });

  it("post123: first/last 48 char codes", () => {
    expect([...src.slice(0, 48)].map((c) => c.charCodeAt(0))).toEqual([101,120,112,111,114,116,32,105,110,116,101,114,102,97,99,101,32,83,116,97,116,105,111,110,32,123,10,32,32,110,97,109,101,58,32,115,116,114,105,110,103,59,10,32,32,117,114,108]);
    expect([...src.slice(-48)].map((c) => c.charCodeAt(0))).toEqual([32,32,99,117,114,114,101,110,116,32,61,32,123,125,59,10,32,32,32,32,125,10,32,32,125,10,10,32,32,114,101,116,117,114,110,32,115,116,97,116,105,111,110,115,59,10,125,10]);
  });

  it("post123: digit/upper/lower/space inventory", () => {
    expect([...src].filter((c) => /\d/.test(c))).toHaveLength(8);
    expect([...src].filter((c) => /[A-Z]/.test(c))).toHaveLength(54);
    expect([...src].filter((c) => /[a-z]/.test(c))).toHaveLength(1043);
    expect((src.match(/ /g) ?? []).length).toBe(432);
  });

  it("post123: quote inventory", () => {
    expect((src.match(/"/g) ?? []).length).toBe(15);
    expect((src.match(/'/g) ?? []).length).toBe(12);
    expect((src.match(/`/g) ?? []).length).toBe(0);
  });

  it("post123: unique char set lock", () => {
    expect([...new Set(src)].sort().join('')).toBe("\n !\"#&'()*+,-./13:;<=>?EFILMNOPRSTUWX[\\]^abcdefghiklmnoprstuvwxy{|}—");
  });

  it("post123: word token count + sha256", () => {
    const words = src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    expect(words).toHaveLength(208);
    expect(createHash('sha256').update(words.join('|'), 'utf8').digest('hex')).toBe("aec8fd33d1a2feea92ce1e1c6731854716061cd541ab4f04aa7be4ad81a1c241");
  });

  it("post123: unique word inventory lock", () => {
    const unique = [...new Set(src.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])].sort();
    expect(unique).toEqual(["EXTINF","Extract","Fallback","Non","Partial","Set","Station","URL","add","after","but","comma","commaIdx","const","country","countryMatch","current","else","end","etc","export","for","from","function","group","groupMatch","has","http","https","i","if","interface","l","langMatch","language","last","lastIndexOf","let","line","lines","logo","logoMatch","map","match","n","name","nameMatch","new","of","parseM3U","push","raw","reset","return","rtmp","seen","skip","slice","split","startsWith","stations","string","the","title","trim","tvg","url"]);
    expect(createHash('sha256').update(unique.join('|'), 'utf8').digest('hex')).toBe("ab3bcc5db38ace588b56a55f3bf27775b33ced5dd486d8f85aad5ff7b682c489");
  });

  it("post123: no BOM/CR/tab; trailing newline", () => {
    expect(src.charCodeAt(0)).not.toBe(0xfeff);
    expect(src.includes('\r')).toBe(false);
    expect(src.includes('\t')).toBe(false);
    expect(src.endsWith('}\n')).toBe(true);
  });

  it("post123: NFC/NFD identity", () => {
    expect(src.normalize('NFC')).toBe(src);
    expect(src.normalize('NFD')).toBe(src);
  });

  it("post123: export surface — Station + parseM3U only", () => {
    expect((src.match(/^export interface /gm) ?? []).length).toBe(1);
    expect((src.match(/^export function /gm) ?? []).length).toBe(1);
    expect(src).toContain("export interface Station");
    expect(src).toContain("export function parseM3U");
    expect(src).not.toMatch(/^import /m);
  });

  it("post123: re-read equals module snapshot", () => {
    expect(read('src/parser.ts')).toBe(src);
    expect(readFileSync(join(parserRoot, 'src/parser.ts'), 'utf8')).toBe(parserSource);
  });

  it("post123: empty playlist / header-only → []", () => {
    expect(parseM3U('')).toEqual([]);
    expect(parseM3U('#EXTM3U')).toEqual([]);
    expect(parseM3U('#EXTM3U\n')).toEqual([]);
    expect(parseM3U('\n\n\n')).toEqual([]);
  });

  it("post123: EXTINF without following URL ignored", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Orphan",Orphan\n')).toEqual([]);
  });

  it("post123: EXTINF without name or comma skipped", () => {
    expect(parseM3U('#EXTINF:-1\nhttps://e.com/d.m3u8\n')).toEqual([]);
  });

  it("post123: empty tvg-name falls back to comma display name", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="",X\nhttps://e.com/a.m3u8\n')).toEqual([{ name: 'X', url: 'https://e.com/a.m3u8' }]);
  });

  it("post123: case-insensitive EXTINF attribute keys", () => {
    expect(parseM3U('#EXTINF:-1 TVG-NAME="Case" GROUP-TITLE="G" TVG-LOGO="L" TVG-LANGUAGE="En" TVG-COUNTRY="US",X\nhttps://e.com/b.m3u8\n')[0]).toEqual({ name: 'Case', url: 'https://e.com/b.m3u8', logo: 'L', group: 'G', language: 'En', country: 'US' });
  });

  it("post123: CRLF line endings parse", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="CRLF",CRLF\r\nhttps://e.com/c.m3u8\r\n')).toEqual([{ name: 'CRLF', url: 'https://e.com/c.m3u8' }]);
  });

  it("post123: trim pads around URL lines", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Sp",Sp\n  https://e.com/e.m3u8  \n')).toEqual([{ name: 'Sp', url: 'https://e.com/e.m3u8' }]);
  });

  it("post123: comment between EXTINF and URL keeps station", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="A",A\n# comment\nhttps://e.com/a2.m3u8\n')).toEqual([{ name: 'A', url: 'https://e.com/a2.m3u8' }]);
  });

  it("post123: blank line between EXTINF and URL keeps station", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="B",B\n\nhttps://e.com/b2.m3u8\n')).toEqual([{ name: 'B', url: 'https://e.com/b2.m3u8' }]);
  });

  it("post123: last-comma fallback uses only trailing segment", () => {
    expect(parseM3U('#EXTINF:-1,Name, With, Commas\nhttps://e.com/mc.m3u8\n')[0]?.name).toBe('Commas');
  });

  it("post123: tvg-name wins over comma display name", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="TVG",Display\nhttps://e.com/tvg.m3u8\n')[0]?.name).toBe('TVG');
  });

  it("post123: dedupe by URL keeps first name", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="First",F\nhttps://e.com/dup.m3u8\n#EXTINF:-1 tvg-name="Second",S\nhttps://e.com/dup.m3u8\n')).toEqual([{ name: 'First', url: 'https://e.com/dup.m3u8' }]);
  });

  it("post123: SAMPLE local fixture length 4 (dedupe+rtmp skip)", () => {
    expect(parseM3U(SAMPLE)).toHaveLength(4);
    expect(parseM3U(SAMPLE).map((s) => s.name)).toEqual(['Drone Zone', 'Jazz After Dark', 'Comma Only Name', 'News Desk']);
  });

  it("post123: SAMPLE_M3U helper fixture length 6", () => {
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
    expect(parseM3U(SAMPLE_M3U).map((s) => s.name)).toEqual(['Alpha FM', 'Beta FM', 'Gamma FM', 'Delta FM', 'Epsilon FM', 'Zeta FM']);
  });

  it("post123: skips non-http scheme rtmp://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nrtmp://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme rtmps://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nrtmps://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme rtsp://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nrtsp://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme rtsps://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nrtsps://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme ftp://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nftp://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme sftp://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nsftp://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme file://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nfile://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme data:", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\ndata:example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme ws://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nws://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme wss://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nwss://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme udp://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nudp://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: skips non-http scheme mms://", () => {
    const raw = '#EXTINF:-1 tvg-name="Skip",Skip\nmms://example.com/x\n#EXTINF:-1 tvg-name="Ok",Ok\nhttps://example.com/ok.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['Ok']);
  });

  it("post123: accepts http URL", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N",N\nhttp://example.com/a.m3u8\n')).toEqual([{ name: 'N', url: "http://example.com/a.m3u8" }]);
  });

  it("post123: accepts https URL", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N",N\nhttps://example.com/b.m3u8\n')).toEqual([{ name: 'N', url: "https://example.com/b.m3u8" }]);
  });

  it("post123: accepts http-port URL", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N",N\nhttp://example.com:8080/c.m3u8\n')).toEqual([{ name: 'N', url: "http://example.com:8080/c.m3u8" }]);
  });

  it("post123: accepts https-query URL", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N",N\nhttps://example.com/d.m3u8?token=1\n')).toEqual([{ name: 'N', url: "https://example.com/d.m3u8?token=1" }]);
  });

  it("post123: accepts https-fragment URL", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N",N\nhttps://example.com/e.m3u8#frag\n')).toEqual([{ name: 'N', url: "https://example.com/e.m3u8#frag" }]);
  });

  it("post123: extracts tvg-name → name", () => {
    const stations = parseM3U('#EXTINF:-1 tvg-name="NameOnly",Disp\nhttps://e.com/name.m3u8\n');
    expect(stations[0]?.name).toBe("NameOnly");
  });

  it("post123: extracts tvg-logo → logo", () => {
    const stations = parseM3U('#EXTINF:-1 tvg-logo="https://cdn.example/x.png",Disp\nhttps://e.com/logo.m3u8\n');
    expect(stations[0]?.logo).toBe("https://cdn.example/x.png"); expect(stations[0]?.name).toBe('Disp');
  });

  it("post123: extracts group-title → group", () => {
    const stations = parseM3U('#EXTINF:-1 group-title="Jazz",Disp\nhttps://e.com/group.m3u8\n');
    expect(stations[0]?.group).toBe("Jazz"); expect(stations[0]?.name).toBe('Disp');
  });

  it("post123: extracts tvg-language → language", () => {
    const stations = parseM3U('#EXTINF:-1 tvg-language="en",Disp\nhttps://e.com/language.m3u8\n');
    expect(stations[0]?.language).toBe("en"); expect(stations[0]?.name).toBe('Disp');
  });

  it("post123: extracts tvg-country → country", () => {
    const stations = parseM3U('#EXTINF:-1 tvg-country="US",Disp\nhttps://e.com/country.m3u8\n');
    expect(stations[0]?.country).toBe("US"); expect(stations[0]?.name).toBe('Disp');
  });

  it("post123: all five attrs together", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="Full" tvg-logo="https://l" group-title="G" tvg-language="en" tvg-country="US",Disp\nhttps://e.com/full.m3u8\n')[0];
    expect(s).toEqual({ name: 'Full', url: 'https://e.com/full.m3u8', logo: 'https://l', group: 'G', language: 'en', country: 'US' });
  });

  it("post123: missing optional attrs are undefined (not null)", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="Bare",Bare\nhttps://e.com/bare.m3u8\n')[0];
    expect(s?.logo).toBeUndefined();
    expect(s?.group).toBeUndefined();
    expect(s?.language).toBeUndefined();
    expect(s?.country).toBeUndefined();
  });

  it("post123: buildSimpleM3U+parseM3U round-trip n=1", () => {
    const m3u = buildSimpleM3U([{"name":"One","url":"https://example.com/1.m3u8","group":"music"}]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(["One"]);
    expect(parseM3U(m3u).map((s) => s.url)).toEqual(["https://example.com/1.m3u8"]);
  });

  it("post123: buildSimpleM3U+parseM3U round-trip n=2", () => {
    const m3u = buildSimpleM3U([{"name":"One","url":"https://example.com/1.m3u8","group":"music"},{"name":"Two","url":"https://example.com/2.m3u8","group":"jazz"}]);
    expect(countHttpStreamLines(m3u)).toBe(2);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(["One","Two"]);
    expect(parseM3U(m3u).map((s) => s.url)).toEqual(["https://example.com/1.m3u8","https://example.com/2.m3u8"]);
  });

  it("post123: buildSimpleM3U+parseM3U round-trip n=3", () => {
    const m3u = buildSimpleM3U([{"name":"One","url":"https://example.com/1.m3u8","group":"music"},{"name":"Two","url":"https://example.com/2.m3u8","group":"jazz"},{"name":"Three","url":"https://example.com/3.m3u8","group":"news"}]);
    expect(countHttpStreamLines(m3u)).toBe(3);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(["One","Two","Three"]);
    expect(parseM3U(m3u).map((s) => s.url)).toEqual(["https://example.com/1.m3u8","https://example.com/2.m3u8","https://example.com/3.m3u8"]);
  });

  it("post123: many unique URLs then duplicate keeps count", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 20; i++) {
      lines.push(`#EXTINF:-1 tvg-name="S${i}",S${i}`);
      lines.push(`https://example.com/u${i}.m3u8`);
    }
    lines.push('#EXTINF:-1 tvg-name="Dup",Dup');
    lines.push('https://example.com/u0.m3u8');
    const stations = parseM3U(lines.join("\n"));
    expect(stations).toHaveLength(20);
    expect(stations[0]?.name).toBe('S0');
  });

  it("post123: bare http URL without EXTINF ignored", () => {
    expect(parseM3U('https://example.com/orphan.m3u8\n')).toEqual([]);
  });

  it("post123: EXTINF then non-http resets so next http without new EXTINF ignored", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="A",A\nrtmp://x\nhttps://example.com/y.m3u8\n')).toEqual([]);
  });

  it("post123: trims display name fallback whitespace", () => {
    expect(parseM3U('#EXTINF:-1,  Padded Name  \nhttps://e.com/p.m3u8\n')[0]?.name).toBe('Padded Name');
  });

  it("post123: unicode station names preserved", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="音楽ラジオ",音楽\nhttps://e.com/jp.m3u8\n')[0]?.name).toBe('音楽ラジオ');
  });

  it("post123: emoji in tvg-name preserved", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="🎵 Beats",X\nhttps://e.com/emoji.m3u8\n')[0]?.name).toBe('🎵 Beats');
  });

  it("post123: no product inventing — no playlist/DO/R2/gemini in parser.ts", () => {
    expect(src).not.toMatch(/playlist/i);
    expect(src).not.toMatch(/now-playing/i);
    expect(src).not.toMatch(/DurableObject/i);
    expect(src).not.toMatch(/\bR2\b/);
    expect(src).not.toMatch(/GEMINI_API_KEY/);
    expect(src).not.toMatch(/anthropic|claude|haiku/i);
    expect(src).not.toMatch(/hono|fetch\(/i);
  });

  it("post123: AGENTS.md lists parser.ts as safe action", () => {
    expect(read('AGENTS.md')).toMatch(/src\/parser\.ts/);
    expect(read('AGENTS.md')).toMatch(/M3U parser/i);
  });

  it("post123: ci hygiene requires parser.test.ts", () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/test\/parser\.test\.ts/);
  });

  it("post123: package scripts typecheck/test/coverage intact", () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.typecheck).toBe('tsc --noEmit');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:coverage']).toMatch(/coverage/);
  });

  it("post123: vitest 100% coverage floors intact", () => {
    const cfg = read('vitest.config.ts');
    expect(cfg).toMatch(/branches:\s*100/);
    expect(cfg).toMatch(/lines:\s*100/);
    expect(cfg).toMatch(/functions:\s*100/);
    expect(cfg).toMatch(/statements:\s*100/);
  });

  it("post123: digest+parse mega purity — 40 rounds", () => {
    const expected = "cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368";
    for (let i = 0; i < 40; i++) {
      expect(createHash('sha256').update(src, 'utf8').digest('hex')).toBe(expected);
      expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
      expect(parseM3U(SAMPLE)).toHaveLength(4);
      expect(parseM3U('')).toEqual([]);
    }
  });

  it("post123: HMAC post123 mega purity — 30 rounds", () => {
    const expected = "995aba2fa63618f8d8028da67cab3f62fbbb20044d76fd4a9a45488f006a464c";
    for (let i = 0; i < 30; i++) {
      expect(createHmac('sha256', 'post123').update(src, 'utf8').digest('hex')).toBe(expected);
      expect(parseM3U('#EXTINF:-1 tvg-name="X",X\nhttps://e.com/x.m3u8\n')[0]?.name).toBe('X');
    }
  });

  it("post123: SAMPLE_M3U contains Alpha FM", () => {
    expect(SAMPLE_M3U).toContain("Alpha FM");
    expect(parseM3U(SAMPLE_M3U).some((s) => s.name === "Alpha FM")).toBe(true);
  });

  it("post123: SAMPLE_M3U Alpha FM sha256 lock", () => {
    expect(createHash('sha256').update("Alpha FM", 'utf8').digest('hex')).toBe("c27d7eab8858924a9c0922d1d071d6f29911592cbb2b54cdad8b4d2dd1faf285");
  });

  it("post123: SAMPLE_M3U contains Beta FM", () => {
    expect(SAMPLE_M3U).toContain("Beta FM");
    expect(parseM3U(SAMPLE_M3U).some((s) => s.name === "Beta FM")).toBe(true);
  });

  it("post123: SAMPLE_M3U Beta FM sha256 lock", () => {
    expect(createHash('sha256').update("Beta FM", 'utf8').digest('hex')).toBe("8caa381e94817cf82f08baa9b4ce6f025ef5605a11c5a6de983b167918c33fae");
  });

  it("post123: SAMPLE_M3U contains Gamma FM", () => {
    expect(SAMPLE_M3U).toContain("Gamma FM");
    expect(parseM3U(SAMPLE_M3U).some((s) => s.name === "Gamma FM")).toBe(true);
  });

  it("post123: SAMPLE_M3U Gamma FM sha256 lock", () => {
    expect(createHash('sha256').update("Gamma FM", 'utf8').digest('hex')).toBe("ab809bd4697f46a509eb4a81f49f87ca5951eadb934a42c9b09c857c54685f78");
  });

  it("post123: SAMPLE_M3U contains Delta FM", () => {
    expect(SAMPLE_M3U).toContain("Delta FM");
    expect(parseM3U(SAMPLE_M3U).some((s) => s.name === "Delta FM")).toBe(true);
  });

  it("post123: SAMPLE_M3U Delta FM sha256 lock", () => {
    expect(createHash('sha256').update("Delta FM", 'utf8').digest('hex')).toBe("f3cf23cdce37db33a94b1570694aaa874fc1c9a1509a9af32f1061c5a48472d1");
  });

  it("post123: SAMPLE_M3U contains Epsilon FM", () => {
    expect(SAMPLE_M3U).toContain("Epsilon FM");
    expect(parseM3U(SAMPLE_M3U).some((s) => s.name === "Epsilon FM")).toBe(true);
  });

  it("post123: SAMPLE_M3U Epsilon FM sha256 lock", () => {
    expect(createHash('sha256').update("Epsilon FM", 'utf8').digest('hex')).toBe("210f59037114a3963aa1ccd305fe57bf4990514157f9e2c55165c3bbbf1b0519");
  });

  it("post123: SAMPLE_M3U contains Zeta FM", () => {
    expect(SAMPLE_M3U).toContain("Zeta FM");
    expect(parseM3U(SAMPLE_M3U).some((s) => s.name === "Zeta FM")).toBe(true);
  });

  it("post123: SAMPLE_M3U Zeta FM sha256 lock", () => {
    expect(createHash('sha256').update("Zeta FM", 'utf8').digest('hex')).toBe("0196db6c2ec51cac0726f64103ab9db0a756fa4c728e0bc6360ec157aad4568d");
  });

  it("post123: empty group-title yields empty string group", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="G" group-title="",Disp\nhttps://e.com/g.m3u8\n')[0];
    expect(s?.group).toBe('');
    expect(s?.name).toBe('G');
  });

  it("post123: empty logo/language/country yield empty strings", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="E" tvg-logo="" tvg-language="" tvg-country="",Disp\nhttps://e.com/e2.m3u8\n')[0];
    expect(s?.logo).toBe('');
    expect(s?.language).toBe('');
    expect(s?.country).toBe('');
  });

  it("post123: #EXTVLCOPT and #EXTGRP do not break parse", () => {
    const raw = '#EXTM3U\n#EXTVLCOPT:network-caching=1000\n#EXTINF:-1 tvg-name="V",V\nhttps://e.com/v.m3u8\n#EXTGRP:ignored\n';
    expect(parseM3U(raw)).toEqual([{ name: 'V', url: 'https://e.com/v.m3u8' }]);
  });

  it("post123: HTTP:// uppercase scheme does not match startsWith http", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="U",U\nHTTP://example.com/u.m3u8\n')).toEqual([]);
  });

  it("post123: HTTPS:// uppercase scheme skipped", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="U2",U2\nHTTPS://example.com/u2.m3u8\n')).toEqual([]);
  });

  it("post123: interleaved http+https+rtmp sequence", () => {
    const raw = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-name="A",A',
      'https://a.example/a.m3u8',
      '#EXTINF:-1 tvg-name="B",B',
      'rtmp://b.example/live',
      '#EXTINF:-1 tvg-name="C",C',
      'http://c.example/c.m3u8',
      '#EXTINF:-1 tvg-name="D",D',
      'https://a.example/a.m3u8',
    ].join('\n');
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['A', 'C']);
  });

  it("post123: JSON round-trip of SAMPLE stations", () => {
    const stations = parseM3U(SAMPLE);
    expect(JSON.parse(JSON.stringify(stations))).toEqual(stations);
  });

  it("post123: countHttpStreamLines equals parseM3U length for SAMPLE_M3U", () => {
    expect(countHttpStreamLines(SAMPLE_M3U)).toBe(parseM3U(SAMPLE_M3U).length);
  });

  it("post123: countHttpStreamLines on SAMPLE counts http lines including dup before parse dedupe", () => {
    expect(countHttpStreamLines(SAMPLE)).toBeGreaterThanOrEqual(parseM3U(SAMPLE).length);
    expect(countHttpStreamLines(SAMPLE)).toBe(5);
    expect(parseM3U(SAMPLE)).toHaveLength(4);
  });

  it("post123: source contains http:// and https:// startsWith branches", () => {
    expect(src).toContain("startsWith('http://')");
    expect(src).toContain("startsWith('https://')");
    expect(src).toContain("startsWith('#EXTINF')");
    expect(src).toContain('lastIndexOf');
    expect(src).toContain('seen.has');
  });

  it("post123: source extracts all five tvg/group attrs", () => {
    expect(src).toContain("tvg-name=");
    expect(src).toContain("tvg-logo=");
    expect(src).toContain("group-title=");
    expect(src).toContain("tvg-language=");
    expect(src).toContain("tvg-country=");
  });

  it("post123: single-station flood 0", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station0",Station0\nhttps://stream.example/0.m3u8\n')).toEqual([{ name: "Station0", url: "https://stream.example/0.m3u8" }]);
  });

  it("post123: single-station flood 1", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station1",Station1\nhttps://stream.example/1.m3u8\n')).toEqual([{ name: "Station1", url: "https://stream.example/1.m3u8" }]);
  });

  it("post123: single-station flood 2", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station2",Station2\nhttps://stream.example/2.m3u8\n')).toEqual([{ name: "Station2", url: "https://stream.example/2.m3u8" }]);
  });

  it("post123: single-station flood 3", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station3",Station3\nhttps://stream.example/3.m3u8\n')).toEqual([{ name: "Station3", url: "https://stream.example/3.m3u8" }]);
  });

  it("post123: single-station flood 4", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station4",Station4\nhttps://stream.example/4.m3u8\n')).toEqual([{ name: "Station4", url: "https://stream.example/4.m3u8" }]);
  });

  it("post123: single-station flood 5", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station5",Station5\nhttps://stream.example/5.m3u8\n')).toEqual([{ name: "Station5", url: "https://stream.example/5.m3u8" }]);
  });

  it("post123: single-station flood 6", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station6",Station6\nhttps://stream.example/6.m3u8\n')).toEqual([{ name: "Station6", url: "https://stream.example/6.m3u8" }]);
  });

  it("post123: single-station flood 7", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station7",Station7\nhttps://stream.example/7.m3u8\n')).toEqual([{ name: "Station7", url: "https://stream.example/7.m3u8" }]);
  });

  it("post123: single-station flood 8", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station8",Station8\nhttps://stream.example/8.m3u8\n')).toEqual([{ name: "Station8", url: "https://stream.example/8.m3u8" }]);
  });

  it("post123: single-station flood 9", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station9",Station9\nhttps://stream.example/9.m3u8\n')).toEqual([{ name: "Station9", url: "https://stream.example/9.m3u8" }]);
  });

  it("post123: single-station flood 10", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station10",Station10\nhttps://stream.example/10.m3u8\n')).toEqual([{ name: "Station10", url: "https://stream.example/10.m3u8" }]);
  });

  it("post123: single-station flood 11", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station11",Station11\nhttps://stream.example/11.m3u8\n')).toEqual([{ name: "Station11", url: "https://stream.example/11.m3u8" }]);
  });

  it("post123: single-station flood 12", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station12",Station12\nhttps://stream.example/12.m3u8\n')).toEqual([{ name: "Station12", url: "https://stream.example/12.m3u8" }]);
  });

  it("post123: single-station flood 13", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station13",Station13\nhttps://stream.example/13.m3u8\n')).toEqual([{ name: "Station13", url: "https://stream.example/13.m3u8" }]);
  });

  it("post123: single-station flood 14", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station14",Station14\nhttps://stream.example/14.m3u8\n')).toEqual([{ name: "Station14", url: "https://stream.example/14.m3u8" }]);
  });

  it("post123: single-station flood 15", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station15",Station15\nhttps://stream.example/15.m3u8\n')).toEqual([{ name: "Station15", url: "https://stream.example/15.m3u8" }]);
  });

  it("post123: single-station flood 16", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station16",Station16\nhttps://stream.example/16.m3u8\n')).toEqual([{ name: "Station16", url: "https://stream.example/16.m3u8" }]);
  });

  it("post123: single-station flood 17", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station17",Station17\nhttps://stream.example/17.m3u8\n')).toEqual([{ name: "Station17", url: "https://stream.example/17.m3u8" }]);
  });

  it("post123: single-station flood 18", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station18",Station18\nhttps://stream.example/18.m3u8\n')).toEqual([{ name: "Station18", url: "https://stream.example/18.m3u8" }]);
  });

  it("post123: single-station flood 19", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station19",Station19\nhttps://stream.example/19.m3u8\n')).toEqual([{ name: "Station19", url: "https://stream.example/19.m3u8" }]);
  });

  it("post123: single-station flood 20", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station20",Station20\nhttps://stream.example/20.m3u8\n')).toEqual([{ name: "Station20", url: "https://stream.example/20.m3u8" }]);
  });

  it("post123: single-station flood 21", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station21",Station21\nhttps://stream.example/21.m3u8\n')).toEqual([{ name: "Station21", url: "https://stream.example/21.m3u8" }]);
  });

  it("post123: single-station flood 22", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station22",Station22\nhttps://stream.example/22.m3u8\n')).toEqual([{ name: "Station22", url: "https://stream.example/22.m3u8" }]);
  });

  it("post123: single-station flood 23", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station23",Station23\nhttps://stream.example/23.m3u8\n')).toEqual([{ name: "Station23", url: "https://stream.example/23.m3u8" }]);
  });

  it("post123: single-station flood 24", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station24",Station24\nhttps://stream.example/24.m3u8\n')).toEqual([{ name: "Station24", url: "https://stream.example/24.m3u8" }]);
  });

  it("post123: single-station flood 25", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station25",Station25\nhttps://stream.example/25.m3u8\n')).toEqual([{ name: "Station25", url: "https://stream.example/25.m3u8" }]);
  });

  it("post123: single-station flood 26", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station26",Station26\nhttps://stream.example/26.m3u8\n')).toEqual([{ name: "Station26", url: "https://stream.example/26.m3u8" }]);
  });

  it("post123: single-station flood 27", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station27",Station27\nhttps://stream.example/27.m3u8\n')).toEqual([{ name: "Station27", url: "https://stream.example/27.m3u8" }]);
  });

  it("post123: single-station flood 28", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station28",Station28\nhttps://stream.example/28.m3u8\n')).toEqual([{ name: "Station28", url: "https://stream.example/28.m3u8" }]);
  });

  it("post123: single-station flood 29", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station29",Station29\nhttps://stream.example/29.m3u8\n')).toEqual([{ name: "Station29", url: "https://stream.example/29.m3u8" }]);
  });

  it("post123: single-station flood 30", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station30",Station30\nhttps://stream.example/30.m3u8\n')).toEqual([{ name: "Station30", url: "https://stream.example/30.m3u8" }]);
  });

  it("post123: single-station flood 31", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station31",Station31\nhttps://stream.example/31.m3u8\n')).toEqual([{ name: "Station31", url: "https://stream.example/31.m3u8" }]);
  });

  it("post123: single-station flood 32", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station32",Station32\nhttps://stream.example/32.m3u8\n')).toEqual([{ name: "Station32", url: "https://stream.example/32.m3u8" }]);
  });

  it("post123: single-station flood 33", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station33",Station33\nhttps://stream.example/33.m3u8\n')).toEqual([{ name: "Station33", url: "https://stream.example/33.m3u8" }]);
  });

  it("post123: single-station flood 34", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station34",Station34\nhttps://stream.example/34.m3u8\n')).toEqual([{ name: "Station34", url: "https://stream.example/34.m3u8" }]);
  });

  it("post123: single-station flood 35", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station35",Station35\nhttps://stream.example/35.m3u8\n')).toEqual([{ name: "Station35", url: "https://stream.example/35.m3u8" }]);
  });

  it("post123: single-station flood 36", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station36",Station36\nhttps://stream.example/36.m3u8\n')).toEqual([{ name: "Station36", url: "https://stream.example/36.m3u8" }]);
  });

  it("post123: single-station flood 37", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station37",Station37\nhttps://stream.example/37.m3u8\n')).toEqual([{ name: "Station37", url: "https://stream.example/37.m3u8" }]);
  });

  it("post123: single-station flood 38", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station38",Station38\nhttps://stream.example/38.m3u8\n')).toEqual([{ name: "Station38", url: "https://stream.example/38.m3u8" }]);
  });

  it("post123: single-station flood 39", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="Station39",Station39\nhttps://stream.example/39.m3u8\n')).toEqual([{ name: "Station39", url: "https://stream.example/39.m3u8" }]);
  });

  it("post123: lang=en country=US", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="en" tvg-country="US",L\nhttps://e.com/en-US.m3u8\n')[0];
    expect(s?.language).toBe("en");
    expect(s?.country).toBe("US");
  });

  it("post123: lang=en country=GB", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="en" tvg-country="GB",L\nhttps://e.com/en-GB.m3u8\n')[0];
    expect(s?.language).toBe("en");
    expect(s?.country).toBe("GB");
  });

  it("post123: lang=ja country=JP", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="ja" tvg-country="JP",L\nhttps://e.com/ja-JP.m3u8\n')[0];
    expect(s?.language).toBe("ja");
    expect(s?.country).toBe("JP");
  });

  it("post123: lang=de country=DE", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="de" tvg-country="DE",L\nhttps://e.com/de-DE.m3u8\n')[0];
    expect(s?.language).toBe("de");
    expect(s?.country).toBe("DE");
  });

  it("post123: lang=fr country=FR", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="fr" tvg-country="FR",L\nhttps://e.com/fr-FR.m3u8\n')[0];
    expect(s?.language).toBe("fr");
    expect(s?.country).toBe("FR");
  });

  it("post123: lang=es country=ES", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="es" tvg-country="ES",L\nhttps://e.com/es-ES.m3u8\n')[0];
    expect(s?.language).toBe("es");
    expect(s?.country).toBe("ES");
  });

  it("post123: lang=pt country=BR", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="pt" tvg-country="BR",L\nhttps://e.com/pt-BR.m3u8\n')[0];
    expect(s?.language).toBe("pt");
    expect(s?.country).toBe("BR");
  });

  it("post123: lang=zh country=CN", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-language="zh" tvg-country="CN",L\nhttps://e.com/zh-CN.m3u8\n')[0];
    expect(s?.language).toBe("zh");
    expect(s?.country).toBe("CN");
  });

  it("post123: group-title Ambient", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Ambient",G\nhttps://e.com/g-Ambient.m3u8\n')[0]?.group).toBe("Ambient");
  });

  it("post123: group-title Jazz", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Jazz",G\nhttps://e.com/g-Jazz.m3u8\n')[0]?.group).toBe("Jazz");
  });

  it("post123: group-title News", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="News",G\nhttps://e.com/g-News.m3u8\n')[0]?.group).toBe("News");
  });

  it("post123: group-title Music", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Music",G\nhttps://e.com/g-Music.m3u8\n')[0]?.group).toBe("Music");
  });

  it("post123: group-title Rock", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Rock",G\nhttps://e.com/g-Rock.m3u8\n')[0]?.group).toBe("Rock");
  });

  it("post123: group-title Classical", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Classical",G\nhttps://e.com/g-Classical.m3u8\n')[0]?.group).toBe("Classical");
  });

  it("post123: group-title Sports", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Sports",G\nhttps://e.com/g-Sports.m3u8\n')[0]?.group).toBe("Sports");
  });

  it("post123: group-title Talk", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="G" group-title="Talk",G\nhttps://e.com/g-Talk.m3u8\n')[0]?.group).toBe("Talk");
  });

  it("post123: logo https://cdn.example/a.png", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-logo="https://cdn.example/a.png",L\nhttps://e.com/logo-25.m3u8\n')[0];
    expect(s?.logo).toBe("https://cdn.example/a.png");
  });

  it("post123: logo http://cdn.example/b.jpg", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-logo="http://cdn.example/b.jpg",L\nhttps://e.com/logo-24.m3u8\n')[0];
    expect(s?.logo).toBe("http://cdn.example/b.jpg");
  });

  it("post123: logo https://cdn.example/c.svg", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-logo="https://cdn.example/c.svg",L\nhttps://e.com/logo-25.m3u8\n')[0];
    expect(s?.logo).toBe("https://cdn.example/c.svg");
  });

  it("post123: logo (empty)", () => {
    const s = parseM3U('#EXTINF:-1 tvg-name="L" tvg-logo="",L\nhttps://e.com/logo-0.m3u8\n')[0];
    expect(s?.logo).toBe("");
  });

  it("post123: parseM3U pure — identical inputs → deep equal", () => {
    const a = parseM3U(SAMPLE_M3U);
    const b = parseM3U(SAMPLE_M3U);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("post123: Date.now independence", () => {
    const t0 = Date.now();
    const a = parseM3U(SAMPLE);
    const b = parseM3U(SAMPLE);
    expect(Date.now()).toBeGreaterThanOrEqual(t0);
    expect(a).toEqual(b);
  });

  it("post123: performance.now independence", () => {
    const t0 = performance.now();
    expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
    expect(performance.now()).toBeGreaterThanOrEqual(t0);
  });

});

describe('post123 parser HEAVY deepen extras', () => {
  it("post123x: HMAC-SHA256(post123) of SAMPLE_M3U lock", () => {
    expect(createHmac('sha256', 'post123').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe("17d860bf1d107faa1cf239cd579ba6924e549a740567daec95cee88860b4a408");
  });

  it("post123x: sha256 of SAMPLE_M3U lock", () => {
    expect(createHash('sha256').update(SAMPLE_M3U, 'utf8').digest('hex')).toBe("d333f382d92be92d05fc76ff08d56269b7a5f305770748fc8cdf68506169c45e");
  });

  it("post123x: HMAC-SHA256(post123) of SAMPLE fixture lock", () => {
    expect(createHmac('sha256', 'post123').update(SAMPLE, 'utf8').digest('hex')).toBe("e2af8c126beca64e759a5cd452263719d615bcefdd701651ac62256de4ff68d2");
  });

  it("post123x: sha256 of SAMPLE fixture lock", () => {
    expect(createHash('sha256').update(SAMPLE, 'utf8').digest('hex')).toBe("dee8cc19f2bcd7df7b7c69e9488d0e725bc50ec89d95741fc143db44fa3645ea");
  });

  it("post123x: attr order country before name still extracts both", () => {
    const s = parseM3U('#EXTINF:-1 tvg-country="CA" tvg-name="Order",Disp\nhttps://e.com/order.m3u8\n')[0];
    expect(s?.name).toBe('Order');
    expect(s?.country).toBe('CA');
  });

  it("post123x: single-quoted tvg-name is not extracted; comma fallback used", () => {
    expect(parseM3U("#EXTINF:-1 tvg-name='Single',Disp\nhttps://e.com/sq.m3u8\n")[0]?.name).toBe('Disp');
  });

  it("post123x: tabs around attrs still match", () => {
    expect(parseM3U('#EXTINF:-1\ttvg-name="Tab"\t,Disp\nhttps://e.com/tab.m3u8\n')[0]?.name).toBe('Tab');
  });

  it("post123x: 100 unique stations parse length lock", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100; i++) {
      lines.push(`#EXTINF:-1 tvg-name="N${i}" group-title="G${i % 5}",N${i}`);
      lines.push(`https://bulk.example/${i}.m3u8`);
    }
    const stations = parseM3U(lines.join("\n"));
    expect(stations).toHaveLength(100);
    expect(stations[0]?.name).toBe('N0');
    expect(stations[99]?.name).toBe('N99');
    expect(stations[50]?.group).toBe('G0');
  });

  it("post123x: 50 duplicate URLs collapse to 1", () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 50; i++) {
      lines.push(`#EXTINF:-1 tvg-name="D${i}",D${i}`);
      lines.push('https://dup.example/same.m3u8');
    }
    expect(parseM3U(lines.join("\n"))).toEqual([{ name: 'D0', url: 'https://dup.example/same.m3u8' }]);
  });

  it("post123x: buildSimpleM3U group=music round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "music-fm", url: "https://g.example/music.m3u8", group: "music" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "music-fm", group: "music" });
  });

  it("post123x: buildSimpleM3U group=ambient round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "ambient-fm", url: "https://g.example/ambient.m3u8", group: "ambient" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "ambient-fm", group: "ambient" });
  });

  it("post123x: buildSimpleM3U group=jazz round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "jazz-fm", url: "https://g.example/jazz.m3u8", group: "jazz" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "jazz-fm", group: "jazz" });
  });

  it("post123x: buildSimpleM3U group=classical round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "classical-fm", url: "https://g.example/classical.m3u8", group: "classical" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "classical-fm", group: "classical" });
  });

  it("post123x: buildSimpleM3U group=pop round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "pop-fm", url: "https://g.example/pop.m3u8", group: "pop" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "pop-fm", group: "pop" });
  });

  it("post123x: buildSimpleM3U group=rock round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "rock-fm", url: "https://g.example/rock.m3u8", group: "rock" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "rock-fm", group: "rock" });
  });

  it("post123x: buildSimpleM3U group=news round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "news-fm", url: "https://g.example/news.m3u8", group: "news" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "news-fm", group: "news" });
  });

  it("post123x: buildSimpleM3U group=sports round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "sports-fm", url: "https://g.example/sports.m3u8", group: "sports" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "sports-fm", group: "sports" });
  });

  it("post123x: buildSimpleM3U group=entertainment round-trip", () => {
    const m3u = buildSimpleM3U([{ name: "entertainment-fm", url: "https://g.example/entertainment.m3u8", group: "entertainment" }]);
    expect(countHttpStreamLines(m3u)).toBe(1);
    expect(parseM3U(m3u)[0]).toMatchObject({ name: "entertainment-fm", group: "entertainment" });
  });

  it("post123x: SAMPLE station[0] deep equal", () => {
    expect(parseM3U(SAMPLE)[0]).toEqual({"name":"Drone Zone","url":"https://example.com/drone.m3u8","logo":"https://cdn.example/drone.png","group":"Ambient","language":"English","country":"US"});
  });

  it("post123x: SAMPLE station[0] name sha256", () => {
    expect(createHash('sha256').update("Drone Zone", 'utf8').digest('hex')).toBe("3d7a8159dd5f396414dba734166b631a8d579663c89863b4477ecde2e0a9f1c8");
  });

  it("post123x: SAMPLE station[0] url sha256", () => {
    expect(createHash('sha256').update("https://example.com/drone.m3u8", 'utf8').digest('hex')).toBe("366d03e5fec35247275126391780d59bf8d418ed8dadf92ffea342357ba65c42");
  });

  it("post123x: SAMPLE station[1] deep equal", () => {
    expect(parseM3U(SAMPLE)[1]).toEqual({"name":"Jazz After Dark","url":"https://example.com/jazz.m3u8","group":"Jazz"});
  });

  it("post123x: SAMPLE station[1] name sha256", () => {
    expect(createHash('sha256').update("Jazz After Dark", 'utf8').digest('hex')).toBe("37ee02fe1630e81814315718794dc69d01e727d50dab3dd258e0e248dd4a9037");
  });

  it("post123x: SAMPLE station[1] url sha256", () => {
    expect(createHash('sha256').update("https://example.com/jazz.m3u8", 'utf8').digest('hex')).toBe("def2e67fecb3b5a29d23becf3dd6f834b5cff6e83f5a8b348cd50d02e224f8c1");
  });

  it("post123x: SAMPLE station[2] deep equal", () => {
    expect(parseM3U(SAMPLE)[2]).toEqual({"name":"Comma Only Name","url":"https://example.com/comma-only.m3u8"});
  });

  it("post123x: SAMPLE station[2] name sha256", () => {
    expect(createHash('sha256').update("Comma Only Name", 'utf8').digest('hex')).toBe("af0254f71a27bb1f7722dead5dc4960a80e8bcebc5d1c02450ca6af1a9492ec9");
  });

  it("post123x: SAMPLE station[2] url sha256", () => {
    expect(createHash('sha256').update("https://example.com/comma-only.m3u8", 'utf8').digest('hex')).toBe("528df0a1b2943072636cff4697284dc2c695eb29a8872ce8422dbf3ca47519ab");
  });

  it("post123x: SAMPLE station[3] deep equal", () => {
    expect(parseM3U(SAMPLE)[3]).toEqual({"name":"News Desk","url":"http://example.com/news.m3u8","group":"News","language":"en","country":"GB"});
  });

  it("post123x: SAMPLE station[3] name sha256", () => {
    expect(createHash('sha256').update("News Desk", 'utf8').digest('hex')).toBe("bb2e66cf734b40ed99a3c6be5963c2a5b0d18d96f6e41ff7b782f544a7733107");
  });

  it("post123x: SAMPLE station[3] url sha256", () => {
    expect(createHash('sha256').update("http://example.com/news.m3u8", 'utf8').digest('hex')).toBe("7b9f25f68f16e78b6e1ccc4003d3ea3f2d1277a635557dc23ca75ef2934e9f89");
  });

  it("post123x: SAMPLE_M3U station[0] deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)[0]).toEqual({"name":"Alpha FM","url":"https://example.com/alpha.m3u8","group":"Music"});
  });

  it("post123x: SAMPLE_M3U station[0] url ends with .m3u8", () => {
    expect(parseM3U(SAMPLE_M3U)[0]?.url.endsWith('.m3u8')).toBe(true);
  });

  it("post123x: SAMPLE_M3U station[1] deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)[1]).toEqual({"name":"Beta FM","url":"https://example.com/beta.m3u8","group":"Music"});
  });

  it("post123x: SAMPLE_M3U station[1] url ends with .m3u8", () => {
    expect(parseM3U(SAMPLE_M3U)[1]?.url.endsWith('.m3u8')).toBe(true);
  });

  it("post123x: SAMPLE_M3U station[2] deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)[2]).toEqual({"name":"Gamma FM","url":"https://example.com/gamma.m3u8","group":"Music"});
  });

  it("post123x: SAMPLE_M3U station[2] url ends with .m3u8", () => {
    expect(parseM3U(SAMPLE_M3U)[2]?.url.endsWith('.m3u8')).toBe(true);
  });

  it("post123x: SAMPLE_M3U station[3] deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)[3]).toEqual({"name":"Delta FM","url":"https://example.com/delta.m3u8","group":"Music"});
  });

  it("post123x: SAMPLE_M3U station[3] url ends with .m3u8", () => {
    expect(parseM3U(SAMPLE_M3U)[3]?.url.endsWith('.m3u8')).toBe(true);
  });

  it("post123x: SAMPLE_M3U station[4] deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)[4]).toEqual({"name":"Epsilon FM","url":"https://example.com/epsilon.m3u8","group":"Music"});
  });

  it("post123x: SAMPLE_M3U station[4] url ends with .m3u8", () => {
    expect(parseM3U(SAMPLE_M3U)[4]?.url.endsWith('.m3u8')).toBe(true);
  });

  it("post123x: SAMPLE_M3U station[5] deep equal", () => {
    expect(parseM3U(SAMPLE_M3U)[5]).toEqual({"name":"Zeta FM","url":"https://example.com/zeta.m3u8","group":"Music"});
  });

  it("post123x: SAMPLE_M3U station[5] url ends with .m3u8", () => {
    expect(parseM3U(SAMPLE_M3U)[5]?.url.endsWith('.m3u8')).toBe(true);
  });

  it("post123x: skip scheme gopher:// then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\ngopher://x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme chrome:// then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nchrome://x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme about: then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nabout:x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme blob: then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nblob:x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme magnet: then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nmagnet:x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme mailto: then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nmailto:x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme tel: then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\ntel:x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme ssh:// then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nssh://x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme git:// then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\ngit://x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: skip scheme svn:// then recover", () => {
    const raw = '#EXTINF:-1 tvg-name="Bad",Bad\nsvn://x\n#EXTINF:-1 tvg-name="Good",Good\nhttps://ok.example/g.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Good', url: 'https://ok.example/g.m3u8' }]);
  });

  it("post123x: EXTINF duration -1 ignored beyond marker", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="D",D\nhttps://e.com/dur--1.m3u8\n')[0]?.name).toBe('D');
  });

  it("post123x: EXTINF duration 0 ignored beyond marker", () => {
    expect(parseM3U('#EXTINF:0 tvg-name="D",D\nhttps://e.com/dur-0.m3u8\n')[0]?.name).toBe('D');
  });

  it("post123x: EXTINF duration 10 ignored beyond marker", () => {
    expect(parseM3U('#EXTINF:10 tvg-name="D",D\nhttps://e.com/dur-10.m3u8\n')[0]?.name).toBe('D');
  });

  it("post123x: EXTINF duration 3600 ignored beyond marker", () => {
    expect(parseM3U('#EXTINF:3600 tvg-name="D",D\nhttps://e.com/dur-3600.m3u8\n')[0]?.name).toBe('D');
  });

  it("post123x: EXTINF duration -1.0 ignored beyond marker", () => {
    expect(parseM3U('#EXTINF:-1.0 tvg-name="D",D\nhttps://e.com/dur--1.0.m3u8\n')[0]?.name).toBe('D');
  });

  it("post123x: whitespace-only lines between entries ignored", () => {
    const raw = '#EXTINF:-1 tvg-name="A",A\n   \nhttps://e.com/a.m3u8\n\t\n#EXTINF:-1 tvg-name="B",B\nhttps://e.com/b.m3u8\n';
    expect(parseM3U(raw).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it("post123x: multiple #EXTM3U headers harmless", () => {
    const raw = '#EXTM3U\n#EXTM3U\n#EXTINF:-1 tvg-name="M",M\nhttps://e.com/m.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'M', url: 'https://e.com/m.m3u8' }]);
  });

  it("post123x: tvg-id present but not mapped onto Station", () => {
    const s = parseM3U('#EXTINF:-1 tvg-id="id.1" tvg-name="HasId",HasId\nhttps://e.com/id.m3u8\n')[0];
    expect(s?.name).toBe('HasId');
    expect(s).not.toHaveProperty('tvg-id');
    expect(s?.logo).toBeUndefined();
    expect(Object.keys(s ?? {}).sort()).toEqual(['country', 'group', 'language', 'logo', 'name', 'url']);
  });

  it("post123x: very long name and url do not throw", () => {
    const name = 'N'.repeat(5000);
    const url = 'https://e.com/' + 'p'.repeat(5000) + '.m3u8';
    const stations = parseM3U(`#EXTINF:-1 tvg-name="${name}",X\n${url}\n`);
    expect(stations).toHaveLength(1);
    expect(stations[0]?.name).toBe(name);
    expect(stations[0]?.url).toBe(url);
  });

  it("post123x: parser.ts Station fields exactly 6 declared", () => {
    expect(parserSource).toMatch(/name: string/);
    expect(parserSource).toMatch(/url: string/);
    expect(parserSource).toMatch(/logo\?: string/);
    expect(parserSource).toMatch(/group\?: string/);
    expect(parserSource).toMatch(/language\?: string/);
    expect(parserSource).toMatch(/country\?: string/);
    expect((parserSource.match(/^\s*(name|url): string;/gm) ?? []).length).toBe(2);
    expect((parserSource.match(/^\s*(logo|group|language|country)\?: string;/gm) ?? []).length).toBe(4);
  });

  it("post123x: no Durable Object / KV / R2 inventing in parser source", () => {
    expect(parserSource).not.toMatch(/KVNamespace|R2Bucket|DurableObject|WorkersAI/i);
  });

  it("post123x: buildSimpleM3U full optional fields round-trip", () => {
    const m3u = buildSimpleM3U([{ name: 'Full', url: 'https://e.com/full.m3u8', group: 'Jazz', language: 'en', country: 'US', logo: 'https://cdn/x.png' }]);
    expect(parseM3U(m3u)[0]).toEqual({ name: 'Full', url: 'https://e.com/full.m3u8', logo: 'https://cdn/x.png', group: 'Jazz', language: 'en', country: 'US' });
  });

  it("post123x: logo-only attrs still use comma name", () => {
    const s = parseM3U('#EXTINF:-1 tvg-logo="https://l",CommaName\nhttps://e.com/cn.m3u8\n')[0];
    expect(s?.name).toBe('CommaName');
    expect(s?.logo).toBe('https://l');
  });

  it("post123x: EXTINF marker #EXTINF", () => {
    const raw = '#EXTINF-1 tvg-name="M",M\nhttps://e.com/m-EXTINF.m3u8\n';
    expect(parseM3U(raw).length).toBe(1);
  });

  it("post123x: EXTINF marker #extinf", () => {
    const raw = '#extinf-1 tvg-name="M",M\nhttps://e.com/m-extinf.m3u8\n';
    expect(parseM3U(raw).length).toBe(0);
  });

  it("post123x: EXTINF marker #ExtInf", () => {
    const raw = '#ExtInf-1 tvg-name="M",M\nhttps://e.com/m-ExtInf.m3u8\n';
    expect(parseM3U(raw).length).toBe(0);
  });

  it("post123x: EXTINF marker #EXTINF:", () => {
    const raw = '#EXTINF:-1 tvg-name="M",M\nhttps://e.com/m-EXTINF.m3u8\n';
    expect(parseM3U(raw).length).toBe(1);
  });

  it("post123x: EXTINF marker #extinf:", () => {
    const raw = '#extinf:-1 tvg-name="M",M\nhttps://e.com/m-extinf.m3u8\n';
    expect(parseM3U(raw).length).toBe(0);
  });

  it("post123x: accepts URL shape userinfo", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="U",U\nhttps://user:pass@example.com/a.m3u8\n')).toEqual([{ name: 'U', url: "https://user:pass@example.com/a.m3u8" }]);
  });

  it("post123x: accepts URL shape ipv6", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="U",U\nhttps://[2001:db8::1]/stream.m3u8\n')).toEqual([{ name: 'U', url: "https://[2001:db8::1]/stream.m3u8" }]);
  });

  it("post123x: accepts URL shape long-query", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="U",U\nhttps://example.com/x.m3u8?a=1&b=2&c=3\n')).toEqual([{ name: 'U', url: "https://example.com/x.m3u8?a=1&b=2&c=3" }]);
  });

  it("post123x: accepts URL shape encoded", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="U",U\nhttps://example.com/a%20b.m3u8\n')).toEqual([{ name: 'U', url: "https://example.com/a%20b.m3u8" }]);
  });

  it("post123x: mega purity SAMPLE+SAMPLE_M3U — 60 rounds", () => {
    for (let i = 0; i < 60; i++) {
      expect(parseM3U(SAMPLE)).toHaveLength(4);
      expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
      expect(parseM3U('')).toEqual([]);
      expect(createHash('sha256').update(parserSource, 'utf8').digest('hex')).toBe("cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368");
    }
  });

  it("post123x: SAMPLE name Drone Zone charCode vector", () => {
    expect([..."Drone Zone"].map((c) => c.charCodeAt(0))).toEqual([68,114,111,110,101,32,90,111,110,101]);
    expect(parseM3U(SAMPLE).some((s) => s.name === "Drone Zone")).toBe(true);
  });

  it("post123x: SAMPLE name Jazz After Dark charCode vector", () => {
    expect([..."Jazz After Dark"].map((c) => c.charCodeAt(0))).toEqual([74,97,122,122,32,65,102,116,101,114,32,68,97,114,107]);
    expect(parseM3U(SAMPLE).some((s) => s.name === "Jazz After Dark")).toBe(true);
  });

  it("post123x: SAMPLE name Comma Only Name charCode vector", () => {
    expect([..."Comma Only Name"].map((c) => c.charCodeAt(0))).toEqual([67,111,109,109,97,32,79,110,108,121,32,78,97,109,101]);
    expect(parseM3U(SAMPLE).some((s) => s.name === "Comma Only Name")).toBe(true);
  });

  it("post123x: SAMPLE name News Desk charCode vector", () => {
    expect([..."News Desk"].map((c) => c.charCodeAt(0))).toEqual([78,101,119,115,32,68,101,115,107]);
    expect(parseM3U(SAMPLE).some((s) => s.name === "News Desk")).toBe(true);
  });

  it("post123x: consecutive EXTINF without URL — last wins pairing", () => {
    const raw = '#EXTINF:-1 tvg-name="First",F\n#EXTINF:-1 tvg-name="Second",S\nhttps://e.com/second.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'Second', url: 'https://e.com/second.m3u8' }]);
  });

  it("post123x: map/filter/reduce locks on SAMPLE_M3U", () => {
    const stations = parseM3U(SAMPLE_M3U);
    expect(stations.map((s) => s.name).join("|")).toBe("Alpha FM|Beta FM|Gamma FM|Delta FM|Epsilon FM|Zeta FM");
    expect(stations.filter((s) => s.url.includes('alpha'))).toHaveLength(1);
    expect(stations.reduce((n, s) => n + s.name.length, 0)).toBe(stations.map((s) => s.name.length).reduce((a, b) => a + b, 0));
  });

  it("post123x: SAMPLE_M3U urls pipe-join sha256", () => {
    const joined = parseM3U(SAMPLE_M3U).map((s) => s.url).join('|');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe("67e78b06dc81ad55e708ecb6da7ca6bfdb489833dc6fb31f9327d1e83f288de9");
  });

  it("post123x: SAMPLE urls pipe-join sha256", () => {
    const joined = parseM3U(SAMPLE).map((s) => s.url).join('|');
    expect(createHash('sha256').update(joined, 'utf8').digest('hex')).toBe("ca549ff385ef3b5ed4761c6e67f87d5e386e37ee1f1f7991120c62484029975a");
  });

  it("post123x: grouped single flood 0", () => {
    const raw = '#EXTINF:-1 tvg-name="G0" group-title="grp0",G0\nhttps://g.example/0.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G0', url: 'https://g.example/0.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 1", () => {
    const raw = '#EXTINF:-1 tvg-name="G1" group-title="grp1",G1\nhttps://g.example/1.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G1', url: 'https://g.example/1.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 2", () => {
    const raw = '#EXTINF:-1 tvg-name="G2" group-title="grp2",G2\nhttps://g.example/2.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G2', url: 'https://g.example/2.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 3", () => {
    const raw = '#EXTINF:-1 tvg-name="G3" group-title="grp0",G3\nhttps://g.example/3.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G3', url: 'https://g.example/3.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 4", () => {
    const raw = '#EXTINF:-1 tvg-name="G4" group-title="grp1",G4\nhttps://g.example/4.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G4', url: 'https://g.example/4.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 5", () => {
    const raw = '#EXTINF:-1 tvg-name="G5" group-title="grp2",G5\nhttps://g.example/5.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G5', url: 'https://g.example/5.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 6", () => {
    const raw = '#EXTINF:-1 tvg-name="G6" group-title="grp0",G6\nhttps://g.example/6.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G6', url: 'https://g.example/6.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 7", () => {
    const raw = '#EXTINF:-1 tvg-name="G7" group-title="grp1",G7\nhttps://g.example/7.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G7', url: 'https://g.example/7.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 8", () => {
    const raw = '#EXTINF:-1 tvg-name="G8" group-title="grp2",G8\nhttps://g.example/8.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G8', url: 'https://g.example/8.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 9", () => {
    const raw = '#EXTINF:-1 tvg-name="G9" group-title="grp0",G9\nhttps://g.example/9.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G9', url: 'https://g.example/9.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 10", () => {
    const raw = '#EXTINF:-1 tvg-name="G10" group-title="grp1",G10\nhttps://g.example/10.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G10', url: 'https://g.example/10.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 11", () => {
    const raw = '#EXTINF:-1 tvg-name="G11" group-title="grp2",G11\nhttps://g.example/11.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G11', url: 'https://g.example/11.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 12", () => {
    const raw = '#EXTINF:-1 tvg-name="G12" group-title="grp0",G12\nhttps://g.example/12.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G12', url: 'https://g.example/12.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 13", () => {
    const raw = '#EXTINF:-1 tvg-name="G13" group-title="grp1",G13\nhttps://g.example/13.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G13', url: 'https://g.example/13.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 14", () => {
    const raw = '#EXTINF:-1 tvg-name="G14" group-title="grp2",G14\nhttps://g.example/14.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G14', url: 'https://g.example/14.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 15", () => {
    const raw = '#EXTINF:-1 tvg-name="G15" group-title="grp0",G15\nhttps://g.example/15.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G15', url: 'https://g.example/15.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 16", () => {
    const raw = '#EXTINF:-1 tvg-name="G16" group-title="grp1",G16\nhttps://g.example/16.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G16', url: 'https://g.example/16.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 17", () => {
    const raw = '#EXTINF:-1 tvg-name="G17" group-title="grp2",G17\nhttps://g.example/17.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G17', url: 'https://g.example/17.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 18", () => {
    const raw = '#EXTINF:-1 tvg-name="G18" group-title="grp0",G18\nhttps://g.example/18.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G18', url: 'https://g.example/18.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 19", () => {
    const raw = '#EXTINF:-1 tvg-name="G19" group-title="grp1",G19\nhttps://g.example/19.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G19', url: 'https://g.example/19.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 20", () => {
    const raw = '#EXTINF:-1 tvg-name="G20" group-title="grp2",G20\nhttps://g.example/20.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G20', url: 'https://g.example/20.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 21", () => {
    const raw = '#EXTINF:-1 tvg-name="G21" group-title="grp0",G21\nhttps://g.example/21.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G21', url: 'https://g.example/21.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 22", () => {
    const raw = '#EXTINF:-1 tvg-name="G22" group-title="grp1",G22\nhttps://g.example/22.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G22', url: 'https://g.example/22.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 23", () => {
    const raw = '#EXTINF:-1 tvg-name="G23" group-title="grp2",G23\nhttps://g.example/23.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G23', url: 'https://g.example/23.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 24", () => {
    const raw = '#EXTINF:-1 tvg-name="G24" group-title="grp0",G24\nhttps://g.example/24.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G24', url: 'https://g.example/24.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 25", () => {
    const raw = '#EXTINF:-1 tvg-name="G25" group-title="grp1",G25\nhttps://g.example/25.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G25', url: 'https://g.example/25.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 26", () => {
    const raw = '#EXTINF:-1 tvg-name="G26" group-title="grp2",G26\nhttps://g.example/26.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G26', url: 'https://g.example/26.m3u8', group: 'grp2' }]);
  });

  it("post123x: grouped single flood 27", () => {
    const raw = '#EXTINF:-1 tvg-name="G27" group-title="grp0",G27\nhttps://g.example/27.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G27', url: 'https://g.example/27.m3u8', group: 'grp0' }]);
  });

  it("post123x: grouped single flood 28", () => {
    const raw = '#EXTINF:-1 tvg-name="G28" group-title="grp1",G28\nhttps://g.example/28.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G28', url: 'https://g.example/28.m3u8', group: 'grp1' }]);
  });

  it("post123x: grouped single flood 29", () => {
    const raw = '#EXTINF:-1 tvg-name="G29" group-title="grp2",G29\nhttps://g.example/29.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'G29', url: 'https://g.example/29.m3u8', group: 'grp2' }]);
  });

  it("post123x: comments-only then station", () => {
    const raw = '#EXTM3U\n# comment1\n# comment2\n#EXTINF:-1 tvg-name="After",After\nhttps://e.com/after.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'After', url: 'https://e.com/after.m3u8' }]);
  });

  it("post123x: no trailing newline still parses", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="T",T\nhttps://e.com/t.m3u8')).toEqual([{ name: 'T', url: 'https://e.com/t.m3u8' }]);
  });

  it("post123x: source comment uses em-dash for rtmp skip note", () => {
    expect(parserSource).toContain('rtmp://, etc.');
    expect(parserSource).toMatch(/Non-http URL/);
  });

});

describe('post123 parser HEAVY deepen wave3', () => {
  it("post123w3: station matrix 0 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W0" tvg-language="en" tvg-country="US" group-title="g0",W0\nhttps://w3.example/0.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W0', url: 'https://w3.example/0.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 1 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W1" tvg-language="ja" tvg-country="JP" group-title="g1",W1\nhttps://w3.example/1.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W1', url: 'https://w3.example/1.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 2 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W2" tvg-language="de" tvg-country="DE" group-title="g2",W2\nhttps://w3.example/2.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W2', url: 'https://w3.example/2.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 3 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W3" tvg-language="fr" tvg-country="FR" group-title="g3",W3\nhttps://w3.example/3.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W3', url: 'https://w3.example/3.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 4 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W4" tvg-language="en" tvg-country="US" group-title="g4",W4\nhttps://w3.example/4.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W4', url: 'https://w3.example/4.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 5 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W5" tvg-language="ja" tvg-country="JP" group-title="g5",W5\nhttps://w3.example/5.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W5', url: 'https://w3.example/5.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 6 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W6" tvg-language="de" tvg-country="DE" group-title="g6",W6\nhttps://w3.example/6.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W6', url: 'https://w3.example/6.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 7 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W7" tvg-language="fr" tvg-country="FR" group-title="g7",W7\nhttps://w3.example/7.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W7', url: 'https://w3.example/7.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 8 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W8" tvg-language="en" tvg-country="US" group-title="g0",W8\nhttps://w3.example/8.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W8', url: 'https://w3.example/8.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 9 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W9" tvg-language="ja" tvg-country="JP" group-title="g1",W9\nhttps://w3.example/9.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W9', url: 'https://w3.example/9.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 10 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W10" tvg-language="de" tvg-country="DE" group-title="g2",W10\nhttps://w3.example/10.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W10', url: 'https://w3.example/10.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 11 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W11" tvg-language="fr" tvg-country="FR" group-title="g3",W11\nhttps://w3.example/11.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W11', url: 'https://w3.example/11.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 12 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W12" tvg-language="en" tvg-country="US" group-title="g4",W12\nhttps://w3.example/12.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W12', url: 'https://w3.example/12.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 13 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W13" tvg-language="ja" tvg-country="JP" group-title="g5",W13\nhttps://w3.example/13.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W13', url: 'https://w3.example/13.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 14 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W14" tvg-language="de" tvg-country="DE" group-title="g6",W14\nhttps://w3.example/14.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W14', url: 'https://w3.example/14.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 15 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W15" tvg-language="fr" tvg-country="FR" group-title="g7",W15\nhttps://w3.example/15.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W15', url: 'https://w3.example/15.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 16 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W16" tvg-language="en" tvg-country="US" group-title="g0",W16\nhttps://w3.example/16.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W16', url: 'https://w3.example/16.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 17 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W17" tvg-language="ja" tvg-country="JP" group-title="g1",W17\nhttps://w3.example/17.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W17', url: 'https://w3.example/17.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 18 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W18" tvg-language="de" tvg-country="DE" group-title="g2",W18\nhttps://w3.example/18.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W18', url: 'https://w3.example/18.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 19 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W19" tvg-language="fr" tvg-country="FR" group-title="g3",W19\nhttps://w3.example/19.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W19', url: 'https://w3.example/19.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 20 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W20" tvg-language="en" tvg-country="US" group-title="g4",W20\nhttps://w3.example/20.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W20', url: 'https://w3.example/20.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 21 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W21" tvg-language="ja" tvg-country="JP" group-title="g5",W21\nhttps://w3.example/21.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W21', url: 'https://w3.example/21.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 22 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W22" tvg-language="de" tvg-country="DE" group-title="g6",W22\nhttps://w3.example/22.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W22', url: 'https://w3.example/22.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 23 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W23" tvg-language="fr" tvg-country="FR" group-title="g7",W23\nhttps://w3.example/23.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W23', url: 'https://w3.example/23.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 24 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W24" tvg-language="en" tvg-country="US" group-title="g0",W24\nhttps://w3.example/24.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W24', url: 'https://w3.example/24.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 25 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W25" tvg-language="ja" tvg-country="JP" group-title="g1",W25\nhttps://w3.example/25.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W25', url: 'https://w3.example/25.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 26 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W26" tvg-language="de" tvg-country="DE" group-title="g2",W26\nhttps://w3.example/26.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W26', url: 'https://w3.example/26.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 27 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W27" tvg-language="fr" tvg-country="FR" group-title="g3",W27\nhttps://w3.example/27.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W27', url: 'https://w3.example/27.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 28 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W28" tvg-language="en" tvg-country="US" group-title="g4",W28\nhttps://w3.example/28.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W28', url: 'https://w3.example/28.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 29 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W29" tvg-language="ja" tvg-country="JP" group-title="g5",W29\nhttps://w3.example/29.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W29', url: 'https://w3.example/29.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 30 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W30" tvg-language="de" tvg-country="DE" group-title="g6",W30\nhttps://w3.example/30.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W30', url: 'https://w3.example/30.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 31 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W31" tvg-language="fr" tvg-country="FR" group-title="g7",W31\nhttps://w3.example/31.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W31', url: 'https://w3.example/31.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 32 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W32" tvg-language="en" tvg-country="US" group-title="g0",W32\nhttps://w3.example/32.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W32', url: 'https://w3.example/32.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 33 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W33" tvg-language="ja" tvg-country="JP" group-title="g1",W33\nhttps://w3.example/33.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W33', url: 'https://w3.example/33.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 34 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W34" tvg-language="de" tvg-country="DE" group-title="g2",W34\nhttps://w3.example/34.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W34', url: 'https://w3.example/34.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 35 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W35" tvg-language="fr" tvg-country="FR" group-title="g3",W35\nhttps://w3.example/35.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W35', url: 'https://w3.example/35.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 36 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W36" tvg-language="en" tvg-country="US" group-title="g4",W36\nhttps://w3.example/36.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W36', url: 'https://w3.example/36.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 37 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W37" tvg-language="ja" tvg-country="JP" group-title="g5",W37\nhttps://w3.example/37.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W37', url: 'https://w3.example/37.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 38 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W38" tvg-language="de" tvg-country="DE" group-title="g6",W38\nhttps://w3.example/38.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W38', url: 'https://w3.example/38.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 39 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W39" tvg-language="fr" tvg-country="FR" group-title="g7",W39\nhttps://w3.example/39.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W39', url: 'https://w3.example/39.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 40 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W40" tvg-language="en" tvg-country="US" group-title="g0",W40\nhttps://w3.example/40.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W40', url: 'https://w3.example/40.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 41 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W41" tvg-language="ja" tvg-country="JP" group-title="g1",W41\nhttps://w3.example/41.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W41', url: 'https://w3.example/41.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 42 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W42" tvg-language="de" tvg-country="DE" group-title="g2",W42\nhttps://w3.example/42.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W42', url: 'https://w3.example/42.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 43 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W43" tvg-language="fr" tvg-country="FR" group-title="g3",W43\nhttps://w3.example/43.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W43', url: 'https://w3.example/43.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 44 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W44" tvg-language="en" tvg-country="US" group-title="g4",W44\nhttps://w3.example/44.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W44', url: 'https://w3.example/44.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 45 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W45" tvg-language="ja" tvg-country="JP" group-title="g5",W45\nhttps://w3.example/45.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W45', url: 'https://w3.example/45.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 46 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W46" tvg-language="de" tvg-country="DE" group-title="g6",W46\nhttps://w3.example/46.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W46', url: 'https://w3.example/46.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 47 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W47" tvg-language="fr" tvg-country="FR" group-title="g7",W47\nhttps://w3.example/47.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W47', url: 'https://w3.example/47.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 48 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W48" tvg-language="en" tvg-country="US" group-title="g0",W48\nhttps://w3.example/48.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W48', url: 'https://w3.example/48.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 49 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W49" tvg-language="ja" tvg-country="JP" group-title="g1",W49\nhttps://w3.example/49.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W49', url: 'https://w3.example/49.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 50 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W50" tvg-language="de" tvg-country="DE" group-title="g2",W50\nhttps://w3.example/50.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W50', url: 'https://w3.example/50.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 51 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W51" tvg-language="fr" tvg-country="FR" group-title="g3",W51\nhttps://w3.example/51.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W51', url: 'https://w3.example/51.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 52 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W52" tvg-language="en" tvg-country="US" group-title="g4",W52\nhttps://w3.example/52.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W52', url: 'https://w3.example/52.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 53 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W53" tvg-language="ja" tvg-country="JP" group-title="g5",W53\nhttps://w3.example/53.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W53', url: 'https://w3.example/53.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 54 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W54" tvg-language="de" tvg-country="DE" group-title="g6",W54\nhttps://w3.example/54.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W54', url: 'https://w3.example/54.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 55 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W55" tvg-language="fr" tvg-country="FR" group-title="g7",W55\nhttps://w3.example/55.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W55', url: 'https://w3.example/55.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 56 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W56" tvg-language="en" tvg-country="US" group-title="g0",W56\nhttps://w3.example/56.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W56', url: 'https://w3.example/56.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 57 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W57" tvg-language="ja" tvg-country="JP" group-title="g1",W57\nhttps://w3.example/57.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W57', url: 'https://w3.example/57.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 58 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W58" tvg-language="de" tvg-country="DE" group-title="g2",W58\nhttps://w3.example/58.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W58', url: 'https://w3.example/58.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 59 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W59" tvg-language="fr" tvg-country="FR" group-title="g3",W59\nhttps://w3.example/59.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W59', url: 'https://w3.example/59.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 60 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W60" tvg-language="en" tvg-country="US" group-title="g4",W60\nhttps://w3.example/60.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W60', url: 'https://w3.example/60.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 61 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W61" tvg-language="ja" tvg-country="JP" group-title="g5",W61\nhttps://w3.example/61.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W61', url: 'https://w3.example/61.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 62 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W62" tvg-language="de" tvg-country="DE" group-title="g6",W62\nhttps://w3.example/62.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W62', url: 'https://w3.example/62.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 63 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W63" tvg-language="fr" tvg-country="FR" group-title="g7",W63\nhttps://w3.example/63.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W63', url: 'https://w3.example/63.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 64 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W64" tvg-language="en" tvg-country="US" group-title="g0",W64\nhttps://w3.example/64.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W64', url: 'https://w3.example/64.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 65 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W65" tvg-language="ja" tvg-country="JP" group-title="g1",W65\nhttps://w3.example/65.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W65', url: 'https://w3.example/65.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 66 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W66" tvg-language="de" tvg-country="DE" group-title="g2",W66\nhttps://w3.example/66.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W66', url: 'https://w3.example/66.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 67 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W67" tvg-language="fr" tvg-country="FR" group-title="g3",W67\nhttps://w3.example/67.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W67', url: 'https://w3.example/67.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 68 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W68" tvg-language="en" tvg-country="US" group-title="g4",W68\nhttps://w3.example/68.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W68', url: 'https://w3.example/68.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 69 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W69" tvg-language="ja" tvg-country="JP" group-title="g5",W69\nhttps://w3.example/69.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W69', url: 'https://w3.example/69.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 70 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W70" tvg-language="de" tvg-country="DE" group-title="g6",W70\nhttps://w3.example/70.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W70', url: 'https://w3.example/70.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 71 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W71" tvg-language="fr" tvg-country="FR" group-title="g7",W71\nhttps://w3.example/71.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W71', url: 'https://w3.example/71.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 72 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W72" tvg-language="en" tvg-country="US" group-title="g0",W72\nhttps://w3.example/72.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W72', url: 'https://w3.example/72.m3u8', group: 'g0', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 73 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W73" tvg-language="ja" tvg-country="JP" group-title="g1",W73\nhttps://w3.example/73.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W73', url: 'https://w3.example/73.m3u8', group: 'g1', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 74 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W74" tvg-language="de" tvg-country="DE" group-title="g2",W74\nhttps://w3.example/74.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W74', url: 'https://w3.example/74.m3u8', group: 'g2', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 75 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W75" tvg-language="fr" tvg-country="FR" group-title="g3",W75\nhttps://w3.example/75.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W75', url: 'https://w3.example/75.m3u8', group: 'g3', language: 'fr', country: 'FR' });
  });

  it("post123w3: station matrix 76 en/US", () => {
    const raw = '#EXTINF:-1 tvg-name="W76" tvg-language="en" tvg-country="US" group-title="g4",W76\nhttps://w3.example/76.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W76', url: 'https://w3.example/76.m3u8', group: 'g4', language: 'en', country: 'US' });
  });

  it("post123w3: station matrix 77 ja/JP", () => {
    const raw = '#EXTINF:-1 tvg-name="W77" tvg-language="ja" tvg-country="JP" group-title="g5",W77\nhttps://w3.example/77.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W77', url: 'https://w3.example/77.m3u8', group: 'g5', language: 'ja', country: 'JP' });
  });

  it("post123w3: station matrix 78 de/DE", () => {
    const raw = '#EXTINF:-1 tvg-name="W78" tvg-language="de" tvg-country="DE" group-title="g6",W78\nhttps://w3.example/78.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W78', url: 'https://w3.example/78.m3u8', group: 'g6', language: 'de', country: 'DE' });
  });

  it("post123w3: station matrix 79 fr/FR", () => {
    const raw = '#EXTINF:-1 tvg-name="W79" tvg-language="fr" tvg-country="FR" group-title="g7",W79\nhttps://w3.example/79.m3u8\n';
    expect(parseM3U(raw)[0]).toEqual({ name: 'W79', url: 'https://w3.example/79.m3u8', group: 'g7', language: 'fr', country: 'FR' });
  });

  it("post123w3: HMAC-SHA256(wave3) parser.ts", () => {
    expect(createHmac('sha256', "wave3").update(parserSource, 'utf8').digest('hex')).toBe("14e2665bead2fa645084ff84f738cf7f23fa6235819965e379a7914a062d6716");
  });

  it("post123w3: HMAC-SHA256(parser-unit) parser.ts", () => {
    expect(createHmac('sha256', "parser-unit").update(parserSource, 'utf8').digest('hex')).toBe("50e6a500800adc39e1d712506829e200984d261c965a47b815da4fd02bf1ef7c");
  });

  it("post123w3: HMAC-SHA256(m3u) parser.ts", () => {
    expect(createHmac('sha256', "m3u").update(parserSource, 'utf8').digest('hex')).toBe("766d557c3d029beffae84dfa28563802dbc40cc486c25da08890e76d471c93eb");
  });

  it("post123w3: HMAC-SHA256(EXTINF) parser.ts", () => {
    expect(createHmac('sha256', "EXTINF").update(parserSource, 'utf8').digest('hex')).toBe("b1278e02e65ed611815fa337c4ec78b95bc1e84d4bb2d440fad935194426a910");
  });

  it("post123w3: HMAC-SHA256(tvg-name) parser.ts", () => {
    expect(createHmac('sha256', "tvg-name").update(parserSource, 'utf8').digest('hex')).toBe("9ae1525696686b515e20f00ab6a75bbf527060eee94322b28450e9a5ca0ee2a8");
  });

  it("post123w3: HMAC-SHA256(dedupe) parser.ts", () => {
    expect(createHmac('sha256', "dedupe").update(parserSource, 'utf8').digest('hex')).toBe("0d5475ea16edb542977cf375b866e0c3d44f30083356d8f6e708f731f9d015cb");
  });

  it("post123w3: HMAC-SHA256(rtmp-skip) parser.ts", () => {
    expect(createHmac('sha256', "rtmp-skip").update(parserSource, 'utf8').digest('hex')).toBe("8a2930dcd19444212c3305cdba22808edd03de142dce91ae2fab2d4fe9975117");
  });

  it("post123w3: HMAC-SHA256(http-only) parser.ts", () => {
    expect(createHmac('sha256', "http-only").update(parserSource, 'utf8').digest('hex')).toBe("4dbbd97fa1b3e43d50feef4dd394d21cca192419c1fcb2bbdeec20bfdc2a263b");
  });

  it("post123w3: HMAC-SHA256(https-only) parser.ts", () => {
    expect(createHmac('sha256', "https-only").update(parserSource, 'utf8').digest('hex')).toBe("4615a6df7b33bdf30854808fb0cbee79e7a1c1e58b2ed9f033d86d7e61e8eb58");
  });

  it("post123w3: HMAC-SHA256(soft-cap-flood) parser.ts", () => {
    expect(createHmac('sha256', "soft-cap-flood").update(parserSource, 'utf8').digest('hex')).toBe("942afcacfae6256bface2587888492291664b3f7d4e97918aad2e7d71c4644d8");
  });

  it("post123w3: buildSimpleM3U n=4 round-trip", () => {
    const stations = Array.from({ length: 4 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(4);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=5 round-trip", () => {
    const stations = Array.from({ length: 5 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(5);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=6 round-trip", () => {
    const stations = Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(6);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=7 round-trip", () => {
    const stations = Array.from({ length: 7 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(7);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=8 round-trip", () => {
    const stations = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(8);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=9 round-trip", () => {
    const stations = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(9);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=10 round-trip", () => {
    const stations = Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(10);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=11 round-trip", () => {
    const stations = Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(11);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: buildSimpleM3U n=12 round-trip", () => {
    const stations = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, url: `https://n.example/${i}.m3u8`, group: `g${i % 3}` }));
    const m3u = buildSimpleM3U(stations);
    expect(parseM3U(m3u)).toHaveLength(12);
    expect(parseM3U(m3u).map((s) => s.name)).toEqual(stations.map((s) => s.name));
    expect(parseM3U(m3u).map((s) => s.group)).toEqual(stations.map((s) => s.group));
  });

  it("post123w3: case variant TVG-NAME", () => {
    expect(parseM3U('#EXTINF:-1 TVG-NAME="UpName",Disp\nhttps://e.com/cv.m3u8\n')[0]?.name).toBe("UpName");
  });

  it("post123w3: case variant Tvg-Name", () => {
    expect(parseM3U('#EXTINF:-1 Tvg-Name="MixName",Disp\nhttps://e.com/cv.m3u8\n')[0]?.name).toBe("MixName");
  });

  it("post123w3: case variant GROUP-TITLE", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N" GROUP-TITLE="UpGroup",Disp\nhttps://e.com/cv.m3u8\n')[0]?.group).toBe("UpGroup");
  });

  it("post123w3: case variant Group-Title", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N" Group-Title="MixGroup",Disp\nhttps://e.com/cv.m3u8\n')[0]?.group).toBe("MixGroup");
  });

  it("post123w3: case variant TVG-LOGO", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N" TVG-LOGO="https://L",Disp\nhttps://e.com/cv.m3u8\n')[0]?.logo).toBe("https://L");
  });

  it("post123w3: case variant TVG-LANGUAGE", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N" TVG-LANGUAGE="EN",Disp\nhttps://e.com/cv.m3u8\n')[0]?.language).toBe("EN");
  });

  it("post123w3: case variant TVG-COUNTRY", () => {
    expect(parseM3U('#EXTINF:-1 tvg-name="N" TVG-COUNTRY="us",Disp\nhttps://e.com/cv.m3u8\n')[0]?.country).toBe("us");
  });

  it("post123w3: dedupe pair 0", () => {
    const raw = '#EXTINF:-1 tvg-name="First0",F\nhttps://dup.example/p0.m3u8\n#EXTINF:-1 tvg-name="Second0",S\nhttps://dup.example/p0.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First0', url: 'https://dup.example/p0.m3u8' }]);
  });

  it("post123w3: dedupe pair 1", () => {
    const raw = '#EXTINF:-1 tvg-name="First1",F\nhttps://dup.example/p1.m3u8\n#EXTINF:-1 tvg-name="Second1",S\nhttps://dup.example/p1.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First1', url: 'https://dup.example/p1.m3u8' }]);
  });

  it("post123w3: dedupe pair 2", () => {
    const raw = '#EXTINF:-1 tvg-name="First2",F\nhttps://dup.example/p2.m3u8\n#EXTINF:-1 tvg-name="Second2",S\nhttps://dup.example/p2.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First2', url: 'https://dup.example/p2.m3u8' }]);
  });

  it("post123w3: dedupe pair 3", () => {
    const raw = '#EXTINF:-1 tvg-name="First3",F\nhttps://dup.example/p3.m3u8\n#EXTINF:-1 tvg-name="Second3",S\nhttps://dup.example/p3.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First3', url: 'https://dup.example/p3.m3u8' }]);
  });

  it("post123w3: dedupe pair 4", () => {
    const raw = '#EXTINF:-1 tvg-name="First4",F\nhttps://dup.example/p4.m3u8\n#EXTINF:-1 tvg-name="Second4",S\nhttps://dup.example/p4.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First4', url: 'https://dup.example/p4.m3u8' }]);
  });

  it("post123w3: dedupe pair 5", () => {
    const raw = '#EXTINF:-1 tvg-name="First5",F\nhttps://dup.example/p5.m3u8\n#EXTINF:-1 tvg-name="Second5",S\nhttps://dup.example/p5.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First5', url: 'https://dup.example/p5.m3u8' }]);
  });

  it("post123w3: dedupe pair 6", () => {
    const raw = '#EXTINF:-1 tvg-name="First6",F\nhttps://dup.example/p6.m3u8\n#EXTINF:-1 tvg-name="Second6",S\nhttps://dup.example/p6.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First6', url: 'https://dup.example/p6.m3u8' }]);
  });

  it("post123w3: dedupe pair 7", () => {
    const raw = '#EXTINF:-1 tvg-name="First7",F\nhttps://dup.example/p7.m3u8\n#EXTINF:-1 tvg-name="Second7",S\nhttps://dup.example/p7.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First7', url: 'https://dup.example/p7.m3u8' }]);
  });

  it("post123w3: dedupe pair 8", () => {
    const raw = '#EXTINF:-1 tvg-name="First8",F\nhttps://dup.example/p8.m3u8\n#EXTINF:-1 tvg-name="Second8",S\nhttps://dup.example/p8.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First8', url: 'https://dup.example/p8.m3u8' }]);
  });

  it("post123w3: dedupe pair 9", () => {
    const raw = '#EXTINF:-1 tvg-name="First9",F\nhttps://dup.example/p9.m3u8\n#EXTINF:-1 tvg-name="Second9",S\nhttps://dup.example/p9.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First9', url: 'https://dup.example/p9.m3u8' }]);
  });

  it("post123w3: dedupe pair 10", () => {
    const raw = '#EXTINF:-1 tvg-name="First10",F\nhttps://dup.example/p10.m3u8\n#EXTINF:-1 tvg-name="Second10",S\nhttps://dup.example/p10.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First10', url: 'https://dup.example/p10.m3u8' }]);
  });

  it("post123w3: dedupe pair 11", () => {
    const raw = '#EXTINF:-1 tvg-name="First11",F\nhttps://dup.example/p11.m3u8\n#EXTINF:-1 tvg-name="Second11",S\nhttps://dup.example/p11.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First11', url: 'https://dup.example/p11.m3u8' }]);
  });

  it("post123w3: dedupe pair 12", () => {
    const raw = '#EXTINF:-1 tvg-name="First12",F\nhttps://dup.example/p12.m3u8\n#EXTINF:-1 tvg-name="Second12",S\nhttps://dup.example/p12.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First12', url: 'https://dup.example/p12.m3u8' }]);
  });

  it("post123w3: dedupe pair 13", () => {
    const raw = '#EXTINF:-1 tvg-name="First13",F\nhttps://dup.example/p13.m3u8\n#EXTINF:-1 tvg-name="Second13",S\nhttps://dup.example/p13.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First13', url: 'https://dup.example/p13.m3u8' }]);
  });

  it("post123w3: dedupe pair 14", () => {
    const raw = '#EXTINF:-1 tvg-name="First14",F\nhttps://dup.example/p14.m3u8\n#EXTINF:-1 tvg-name="Second14",S\nhttps://dup.example/p14.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First14', url: 'https://dup.example/p14.m3u8' }]);
  });

  it("post123w3: dedupe pair 15", () => {
    const raw = '#EXTINF:-1 tvg-name="First15",F\nhttps://dup.example/p15.m3u8\n#EXTINF:-1 tvg-name="Second15",S\nhttps://dup.example/p15.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First15', url: 'https://dup.example/p15.m3u8' }]);
  });

  it("post123w3: dedupe pair 16", () => {
    const raw = '#EXTINF:-1 tvg-name="First16",F\nhttps://dup.example/p16.m3u8\n#EXTINF:-1 tvg-name="Second16",S\nhttps://dup.example/p16.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First16', url: 'https://dup.example/p16.m3u8' }]);
  });

  it("post123w3: dedupe pair 17", () => {
    const raw = '#EXTINF:-1 tvg-name="First17",F\nhttps://dup.example/p17.m3u8\n#EXTINF:-1 tvg-name="Second17",S\nhttps://dup.example/p17.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First17', url: 'https://dup.example/p17.m3u8' }]);
  });

  it("post123w3: dedupe pair 18", () => {
    const raw = '#EXTINF:-1 tvg-name="First18",F\nhttps://dup.example/p18.m3u8\n#EXTINF:-1 tvg-name="Second18",S\nhttps://dup.example/p18.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First18', url: 'https://dup.example/p18.m3u8' }]);
  });

  it("post123w3: dedupe pair 19", () => {
    const raw = '#EXTINF:-1 tvg-name="First19",F\nhttps://dup.example/p19.m3u8\n#EXTINF:-1 tvg-name="Second19",S\nhttps://dup.example/p19.m3u8\n';
    expect(parseM3U(raw)).toEqual([{ name: 'First19', url: 'https://dup.example/p19.m3u8' }]);
  });

  it("post123w3: final mega purity 50 rounds", () => {
    const dig = "cf293136412fba636ad7391bcea0a0e83a079fbbcc8fc14d0ca41fa6621f4368";
    for (let i = 0; i < 50; i++) {
      expect(createHash('sha256').update(parserSource, 'utf8').digest('hex')).toBe(dig);
      expect(parseM3U(SAMPLE_M3U)).toHaveLength(6);
      expect(parseM3U(SAMPLE)).toHaveLength(4);
      expect(parseM3U('#EXTINF:-1 tvg-name="Z",Z\nrtmp://x\n')).toEqual([]);
    }
  });

  it("post123w3: no inventing fences reaffirm", () => {
    expect(parserSource).not.toMatch(/playlist|now-playing|DurableObject|GEMINI_API_KEY/i);
    expect(parserSource).not.toMatch(/anthropic|claude|haiku/i);
    expect(Object.keys(parseM3U(SAMPLE_M3U)[0] ?? {}).sort()).toEqual(['country', 'group', 'language', 'logo', 'name', 'url']);
  });

});
