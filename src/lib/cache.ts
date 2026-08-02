/**
 * Generic ndjson cache: append-only snapshots keyed by string.
 * Each write appends a timestamped entry for future diffing.
 */

import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

let CACHE_ROOT = join(process.cwd(), "output", "cache");

export interface Snapshot<T = unknown> {
  timestamp: string;
  data: T;
}

/** Override the cache root directory (for tests). */
export function setCacheRoot(root: string): void {
  CACHE_ROOT = root;
}

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function ensureDir(): void {
  mkdirSync(CACHE_ROOT, { recursive: true });
}

/**
 * Append a snapshot to a cache file keyed by name.
 * Returns the path written to.
 */
export function cacheAppend<T>(key: string, data: T): string {
  ensureDir();
  const file = join(CACHE_ROOT, `${safeFilename(key)}.ndjson`);
  const entry: Snapshot<T> = { timestamp: now(), data };
  appendFileSync(file, JSON.stringify(entry) + "\n");
  return file;
}

/**
 * Read all snapshots for a given key, ordered oldest → newest.
 */
export function cacheReadAll<T>(key: string): Snapshot<T>[] {
  const file = join(CACHE_ROOT, `${safeFilename(key)}.ndjson`);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as Snapshot<T>);
}

/**
 * Read the latest snapshot for a given key, or null if none.
 */
export function cacheReadLatest<T>(key: string): Snapshot<T> | null {
  const all = cacheReadAll<T>(key);
  return all.length > 0 ? all[all.length - 1] : null;
}

/**
 * Remove snapshots older than a given timestamp (format: YYYY-MM-DDTHH:MM).
 * Returns the number of entries removed.
 */
export function cacheRemoveBefore<T>(key: string, before: string): number {
  const file = join(CACHE_ROOT, `${safeFilename(key)}.ndjson`);
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    const entry = JSON.parse(line) as Snapshot<T>;
    if (entry.timestamp < before) {
      removed++;
    } else {
      kept.push(line);
    }
  }
  writeFileSync(file, kept.length > 0 ? kept.join("\n") + "\n" : "");
  return removed;
}

/**
 * Keep only the latest snapshot per unique thread/group key.
 * The `threadFn` extracts the grouping key from each entry's data.
 * Returns the number of entries removed.
 */
export function cacheCompact<T>(key: string, threadFn: (data: T) => string): number {
  const file = join(CACHE_ROOT, `${safeFilename(key)}.ndjson`);
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const latestByThread = new Map<string, string>();
  for (const line of lines) {
    const entry = JSON.parse(line) as Snapshot<T>;
    const thread = threadFn(entry.data);
    latestByThread.set(thread, line);
  }
  const kept = [...latestByThread.values()];
  const removed = lines.length - kept.length;
  writeFileSync(file, kept.length > 0 ? kept.join("\n") + "\n" : "");
  return removed;
}

/**
 * Count snapshots for a given key.
 */
export function cacheCount(key: string): number {
  const file = join(CACHE_ROOT, `${safeFilename(key)}.ndjson`);
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf-8").trim().split("\n").filter(Boolean).length;
}

/**
 * List all cached keys.
 */
export function cacheList(): string[] {
  if (!existsSync(CACHE_ROOT)) return [];
  return readdirSync(CACHE_ROOT)
    .filter((f) => f.endsWith(".ndjson"))
    .map((f) => f.replace(".ndjson", ""));
}

export function getCacheRoot(): string {
  return CACHE_ROOT;
}
