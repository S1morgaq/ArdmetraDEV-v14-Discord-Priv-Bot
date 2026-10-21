const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parses strings such as "30s", "10m", "1h30m", "2d" into milliseconds. Returns null when invalid. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const re = /(\d+)([smhdw])/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index !== consumed) return null;
    total += Number(match[1]) * UNITS[match[2]];
    consumed += match[0].length;
  }
  if (consumed !== text.length || total <= 0) return null;
  return total;
}

export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = Math.floor(ms / 1000);
  const table: [string, number][] = [
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
    ['s', 1],
  ];
  for (const [label, size] of table) {
    const value = Math.floor(rest / size);
    if (value > 0) {
      parts.push(`${value}${label}`);
      rest -= value * size;
    }
  }
  return parts.length > 0 ? parts.join(' ') : '0s';
}
