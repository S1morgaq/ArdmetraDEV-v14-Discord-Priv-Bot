import fs from 'node:fs';
import path from 'node:path';

/** Recursively lists loadable module files (.js in dist, .ts under tsx), skipping typings and maps. */
export function walkModules(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkModules(full));
    else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) result.push(full);
  }
  return result.sort();
}

/** Loads a module and returns its default export (works for both CJS and transpiled ESM). */
export function loadDefault<T>(file: string): T | undefined {
  // Dynamic loading is the point of these handlers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(file) as { default?: T } | T;
  return (mod as { default?: T }).default ?? (mod as T);
}
