import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readEvents } from "../src/store.js";
import { beaconHeaders, post, tmpDir } from "./helpers.js";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");
const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/events.sample.jsonl");
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("tile command writes the page and prints a summary", () => {
  const dir = tmpDir();
  try {
    const out = path.join(dir, "tile.html");
    const r = run("tile", "--data", SAMPLE, "--out", out, "--days", "7", "--title", "Example site", "--now", "2026-11-04T12:30:00Z");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /wrote .*tile\.html: 290 views in 7 days, 224 in the days before/);
    const html = readFileSync(out, "utf8");
    assert.match(html, /<title>Example site<\/title>/);
    assert.ok(!/<script/i.test(html));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage errors exit 1 with a message", () => {
  assert.equal(run().status, 1);
  assert.match(run("bogus").stderr, /unknown command/);
  assert.match(run("tile").stderr, /needs --data and --out/);
  assert.match(run("tile", "--data", SAMPLE, "--out", "x.html", "--days", "0").stderr, /whole number/);
  assert.match(run("serve").stderr, /needs --config/);
  assert.match(run("tile", "--data", SAMPLE, "--out", "x.html", "--now", "yesterday").stderr, /--now must be a date/);
  assert.equal(run("--help").status, 0);
});

test("serve refuses a config without allowedOrigins", () => {
  const dir = tmpDir();
  try {
    const config = path.join(dir, "c.json");
    writeFileSync(config, JSON.stringify({ port: 0, dataFile: path.join(dir, "e.jsonl") }));
    const r = run("serve", "--config", config);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /allowedOrigins is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serve collects a beacon end to end, then tile reads it", async () => {
  const dir = tmpDir();
  const config = path.join(dir, "c.json");
  const dataFile = path.join(dir, "events.jsonl");
  writeFileSync(config, JSON.stringify({ port: 0, dataFile, allowedOrigins: ["https://example.com"] }));
  const child = spawn(process.execPath, [CLI, "serve", "--config", config], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (c) => {
        out += c;
        const m = /localhost:(\d+)\/collect/.exec(out);
        if (m) resolve(Number(m[1]));
      });
      child.on("exit", (code) => reject(new Error(`collector exited early (${code})`)));
      setTimeout(() => reject(new Error("collector did not start")), 5000);
    });
    const res = await post(port, JSON.stringify({ p: "/hello", r: "" }), beaconHeaders());
    assert.equal(res.status, 204);
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  try {
    assert.ok(existsSync(dataFile));
    assert.deepEqual(readEvents(dataFile).map((e) => e.p), ["/hello"]);
    const out = path.join(dir, "tile.html");
    assert.equal(run("tile", "--data", dataFile, "--out", out).status, 0);
    assert.match(readFileSync(out, "utf8"), /<td class="path">\/hello<\/td>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
