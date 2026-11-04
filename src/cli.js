#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createCollector } from "./collector.js";
import { computeStats } from "./stats.js";
import { readEvents } from "./store.js";
import { renderTile } from "./tile.js";

const HELP = `first-party-analytics-tile <command> [options]

Commands
  serve --config <file>
      Start the collector. The JSON config accepts: port (8787), host ("localhost"),
      endpoint ("/collect"), dataFile ("./data/events.jsonl"), allowedOrigins (required;
      ["https://example.com"] or ["*"]), ignoreBots (true), maxEventsPerMinute (600),
      retentionDays (0 = keep everything).

  tile --data <events.jsonl> --out <tile.html> [--days 7] [--top 10] [--title "Page views"] [--now <ISO time>]
      Read the events file and write one static HTML page. --now pins the clock
      (for example 2026-11-04T12:30:00Z) so a report can be reproduced later.

  --help    show this text
`;

function fail(message) {
  process.stderr.write(`first-party-analytics-tile: ${message}\n`);
  process.exit(1);
}

function intFlag(values, name, fallback, min = 1) {
  if (values[name] === undefined) return fallback;
  const n = Number(values[name]);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be a whole number of at least ${min}`);
  return n;
}

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "--help" || command === "-h") {
  process.stdout.write(HELP);
  process.exit(command ? 0 : 1);
}

let values;
try {
  ({ values } = parseArgs({
    args: rest,
    options: {
      config: { type: "string" },
      data: { type: "string" },
      out: { type: "string" },
      days: { type: "string" },
      top: { type: "string" },
      title: { type: "string" },
      now: { type: "string" },
    },
  }));
} catch (err) {
  fail(err.message);
}

if (command === "serve") {
  if (!values.config) fail("serve needs --config <file>");
  let config;
  try {
    config = JSON.parse(readFileSync(values.config, "utf8"));
  } catch (err) {
    fail(`cannot read config: ${err.message}`);
  }
  let collector;
  try {
    collector = createCollector({ ...config, log: (m) => process.stderr.write(`${m}\n`) });
  } catch (err) {
    fail(err.message);
  }
  const addr = await collector.listen().catch((err) => fail(`cannot listen: ${err.message}`));
  process.stdout.write(`collector listening on http://${collector.config.host}:${addr.port}${collector.config.endpoint}\n`);
  const stop = async () => {
    await collector.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else if (command === "tile") {
  if (!values.data || !values.out) fail("tile needs --data and --out");
  const days = intFlag(values, "days", 7);
  const top = intFlag(values, "top", 10);
  let now = Date.now();
  if (values.now !== undefined) {
    now = Date.parse(values.now);
    if (Number.isNaN(now)) fail("--now must be a date such as 2026-11-04T12:30:00Z");
  }
  const stats = computeStats(readEvents(values.data), { days, top, now });
  writeFileSync(values.out, renderTile(stats, { title: values.title ?? "Page views", generatedAt: new Date(now) }));
  process.stdout.write(`wrote ${values.out}: ${stats.total} views in ${days} days, ${stats.previousTotal} in the days before\n`);
} else {
  fail(`unknown command "${command}" (see --help)`);
}
