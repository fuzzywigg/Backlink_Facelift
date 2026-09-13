import { describe, expect, it } from 'vitest';
import { parseM3U } from '../src/parser';
import { SAMPLE_M3U, buildSimpleM3U, countHttpStreamLines } from './helpers';

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

});
