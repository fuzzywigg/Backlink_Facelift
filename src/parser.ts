export interface Station {
  name: string;
  url: string;
  logo?: string;
  group?: string;
  language?: string;
  country?: string;
}

export function parseM3U(raw: string): Station[] {
  const lines = raw.split('\n').map((l) => l.trim());
  const stations: Station[] = [];
  const seen = new Set<string>();

  let current: Partial<Station> = {};

  for (const line of lines) {
    if (line.startsWith('#EXTINF')) {
      current = {};

      // Extract tvg-name
      const nameMatch = line.match(/tvg-name="([^"]*)"/i);
      if (nameMatch) current.name = nameMatch[1];

      // Extract tvg-logo
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      if (logoMatch) current.logo = logoMatch[1];

      // Extract group-title
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      if (groupMatch) current.group = groupMatch[1];

      // Extract tvg-language
      const langMatch = line.match(/tvg-language="([^"]*)"/i);
      if (langMatch) current.language = langMatch[1];

      // Extract tvg-country
      const countryMatch = line.match(/tvg-country="([^"]*)"/i);
      if (countryMatch) current.country = countryMatch[1];

      // Fallback name from the end of the #EXTINF line (after last comma)
      if (!current.name) {
        const commaIdx = line.lastIndexOf(',');
        if (commaIdx !== -1) current.name = line.slice(commaIdx + 1).trim();
      }
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      if (current.name && !seen.has(line)) {
        seen.add(line);
        stations.push({
          name: current.name,
          url: line,
          logo: current.logo,
          group: current.group,
          language: current.language,
          country: current.country,
        });
      }
      current = {};
    } else if (line && !line.startsWith('#')) {
      // Non-http URL (rtmp://, etc.) — skip but reset current
      current = {};
    }
  }

  return stations;
}
