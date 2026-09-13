import { describe, expect, it } from 'vitest';
import { parseM3U } from '../src/parser';

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
});
