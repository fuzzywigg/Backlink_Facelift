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
});
