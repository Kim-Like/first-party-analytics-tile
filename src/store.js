import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const HOUR_MS = 3600 * 1000;
const HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

/** "2026-11-04T13" for the UTC hour containing `ms`. Hours are the finest time the store keeps. */
export function hourBucket(ms) {
  return new Date(ms).toISOString().slice(0, 13);
}

export function hourStartMs(bucket) {
  return Date.parse(`${bucket}:00:00Z`);
}

export { HOUR_MS };

export function encodeEvent(event) {
  const row = { h: event.h, p: event.p };
  if (event.r) row.r = event.r;
  return JSON.stringify(row) + "\n";
}

/** Read the events file. Lines that are not valid events are ignored. */
export function readEvents(file) {
  if (!existsSync(file)) return [];
  const events = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row.h !== "string" || !HOUR_RE.test(row.h) || typeof row.p !== "string") continue;
    events.push({ h: row.h, p: row.p, r: typeof row.r === "string" ? row.r : "" });
  }
  return events;
}

/** Drop events older than `days`. Rewrites the file through a temporary file and a rename. */
export function pruneFile(file, { days, now = Date.now() }) {
  const events = readEvents(file);
  const cutoff = hourStartMs(hourBucket(now)) - days * 24 * HOUR_MS;
  const kept = events.filter((e) => hourStartMs(e.h) >= cutoff);
  if (kept.length === events.length) return { kept: kept.length, removed: 0 };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, kept.map(encodeEvent).join(""));
  renameSync(tmp, file);
  return { kept: kept.length, removed: events.length - kept.length };
}
