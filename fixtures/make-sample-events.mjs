// Writes a deterministic sample events file: 14 days of made-up traffic for an example site,
// ending at 2026-11-04 12:00 UTC. Usage: node make-sample-events.mjs <out-file>
import { writeFileSync } from "node:fs";
import { encodeEvent, hourBucket } from "../src/store.js";

export const SAMPLE_NOW = Date.UTC(2026, 10, 4, 12, 30);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PAGES = [
  ["/", 40],
  ["/guides/getting-started", 22],
  ["/guides/pricing-basics", 14],
  ["/blog/launch-notes", 9],
  ["/about", 6],
  ["/contact", 3],
];
const REFERRERS = [["", 60], ["search.example.org", 20], ["news.example.net", 12], ["social.example.com", 8]];

function weighted(rand, table) {
  const total = table.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [value, w] of table) {
    r -= w;
    if (r < 0) return value;
  }
  return table[0][0];
}

export function sampleEvents() {
  const rand = rng(42);
  const events = [];
  for (let hoursAgo = 14 * 24; hoursAgo >= 0; hoursAgo--) {
    const t = SAMPLE_NOW - hoursAgo * 3600 * 1000;
    const recent = hoursAgo < 7 * 24;
    const hourOfDay = new Date(t).getUTCHours();
    const daytime = hourOfDay >= 7 && hourOfDay <= 21 ? 1 : 0.25;
    const expected = (recent ? 2.4 : 1.8) * daytime;
    const count = Math.floor(expected + rand());
    for (let i = 0; i < count; i++) {
      // The blog post only starts getting visits in the current week.
      let p = weighted(rand, PAGES);
      if (p === "/blog/launch-notes" && !recent) p = "/";
      events.push({ h: hourBucket(t), p, r: weighted(rand, REFERRERS) });
    }
  }
  return events;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node make-sample-events.mjs <out-file>");
    process.exit(1);
  }
  const events = sampleEvents();
  writeFileSync(out, events.map(encodeEvent).join(""));
  console.log(`wrote ${events.length} events to ${out}`);
}
