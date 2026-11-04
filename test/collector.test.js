import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { cleanPath, cleanReferrer, createCollector } from "../src/collector.js";
import { encodeEvent, readEvents } from "../src/store.js";
import { beaconHeaders, BROWSER_UA, post, tmpDir } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 4, 12, 30, 45);

async function withCollector(options, fn) {
  const dir = tmpDir();
  const dataFile = path.join(dir, "data", "events.jsonl");
  const collector = createCollector({ port: 0, dataFile, allowedOrigins: ["https://example.com"], now: () => NOW, ...options });
  const { port } = await collector.listen();
  try {
    await fn({ port, dataFile, collector });
  } finally {
    await collector.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const body = (p, r = "") => JSON.stringify({ p, r });

test("a beacon is stored as hour, path and referrer host, nothing else", async () => {
  await withCollector({}, async ({ port, dataFile, collector }) => {
    const res = await post(port, body("/guides/start?utm=abc#top", "https://www.news.example.net/story/1?id=7"), beaconHeaders());
    assert.equal(res.status, 204);
    await collector.flush();
    const raw = readFileSync(dataFile, "utf8");
    assert.equal(raw, '{"h":"2026-11-04T12","p":"/guides/start","r":"news.example.net"}\n');
    assert.ok(!raw.includes("Mozilla"));
    assert.ok(!raw.includes("45"), "seconds are not stored");
  });
});

test("responses set no cookies and carry the matching CORS origin", async () => {
  await withCollector({}, async ({ port }) => {
    const res = await post(port, body("/"), beaconHeaders());
    assert.equal(res.headers["set-cookie"], undefined);
    assert.equal(res.headers["access-control-allow-origin"], "https://example.com");
    assert.equal(res.headers["cache-control"], "no-store");
  });
});

test("unlisted or missing origins are refused and nothing is written", async () => {
  await withCollector({}, async ({ port, dataFile, collector }) => {
    assert.equal((await post(port, body("/"), beaconHeaders("https://other.example.org"))).status, 403);
    const noOrigin = beaconHeaders();
    delete noOrigin.Origin;
    assert.equal((await post(port, body("/"), noOrigin)).status, 403);
    await collector.flush();
    assert.equal(existsSync(dataFile), false);
  });
});

test('allowedOrigins ["*"] accepts any origin', async () => {
  await withCollector({ allowedOrigins: ["*"] }, async ({ port, collector, dataFile }) => {
    const res = await post(port, body("/x"), beaconHeaders("https://anything.example.org"));
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "*");
    await collector.flush();
    assert.equal(readEvents(dataFile).length, 1);
  });
});

test("allowedOrigins is required", () => {
  assert.throws(() => createCollector({ dataFile: path.join(tmpDir(), "e.jsonl") }), /allowedOrigins is required/);
});

test("Do Not Track, Global Privacy Control and bots are accepted but not counted", async () => {
  await withCollector({}, async ({ port, dataFile, collector }) => {
    for (const extra of [{ DNT: "1" }, { "Sec-GPC": "1" }, { "User-Agent": "ExampleBot/2.1 (+crawler)" }, { "User-Agent": "curl/8.0" }]) {
      assert.equal((await post(port, body("/"), beaconHeaders("https://example.com", extra))).status, 204);
    }
    const noUa = beaconHeaders();
    delete noUa["User-Agent"];
    assert.equal((await post(port, body("/"), noUa)).status, 204);
    await collector.flush();
    assert.equal(existsSync(dataFile), false);
  });
});

test("ignoreBots false counts bot traffic", async () => {
  await withCollector({ ignoreBots: false }, async ({ port, dataFile, collector }) => {
    await post(port, body("/"), beaconHeaders("https://example.com", { "User-Agent": "ExampleBot/2.1" }));
    await collector.flush();
    assert.equal(readEvents(dataFile).length, 1);
  });
});

test("bad payloads: invalid JSON, bad paths, oversized body", async () => {
  await withCollector({}, async ({ port, dataFile, collector }) => {
    assert.equal((await post(port, "not json", beaconHeaders())).status, 400);
    assert.equal((await post(port, body("no-slash"), beaconHeaders())).status, 400);
    assert.equal((await post(port, body("//example.org/x"), beaconHeaders())).status, 400);
    assert.equal((await post(port, body("/a b"), beaconHeaders())).status, 400);
    assert.equal((await post(port, body("/" + "a".repeat(250)), beaconHeaders())).status, 400);
    assert.equal((await post(port, JSON.stringify({ p: 5 }), beaconHeaders())).status, 400);
    assert.equal((await post(port, JSON.stringify({ p: "/", pad: "x".repeat(5000) }), beaconHeaders())).status, 413);
    await collector.flush();
    assert.equal(existsSync(dataFile), false);
  });
});

test("rate limit: events beyond the per-minute cap get 429 and are not stored", async () => {
  await withCollector({ maxEventsPerMinute: 2 }, async ({ port, dataFile, collector }) => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(port, body(`/p${i}`), beaconHeaders())).status);
    assert.deepEqual(statuses, [204, 204, 429, 429]);
    await collector.flush();
    assert.equal(readEvents(dataFile).length, 2);
  });
});

test("the rate limit window moves with the clock", async () => {
  let t = NOW;
  await withCollector({ maxEventsPerMinute: 1, now: () => t }, async ({ port }) => {
    assert.equal((await post(port, body("/a"), beaconHeaders())).status, 204);
    assert.equal((await post(port, body("/b"), beaconHeaders())).status, 429);
    t += 61000;
    assert.equal((await post(port, body("/c"), beaconHeaders())).status, 204);
  });
});

test("a referrer from the site itself is dropped", async () => {
  await withCollector({}, async ({ port, dataFile, collector }) => {
    await post(port, body("/b", "https://example.com/a"), beaconHeaders());
    await post(port, body("/b", "https://www.example.com/a"), beaconHeaders());
    await collector.flush();
    assert.deepEqual(readEvents(dataFile).map((e) => e.r), ["", ""]);
  });
});

test("preflight, health, 404 and 405", async () => {
  await withCollector({}, async ({ port }) => {
    const pre = await post(port, undefined, { Origin: "https://example.com" }, "/collect", "OPTIONS");
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-origin"], "https://example.com");
    assert.match(pre.headers["access-control-allow-methods"], /POST/);
    const preBad = await post(port, undefined, { Origin: "https://other.example.org" }, "/collect", "OPTIONS");
    assert.equal(preBad.headers["access-control-allow-origin"], undefined);
    assert.equal((await post(port, undefined, {}, "/health", "GET")).status, 200);
    assert.equal((await post(port, undefined, {}, "/elsewhere", "GET")).status, 404);
    assert.equal((await post(port, undefined, {}, "/collect", "GET")).status, 405);
  });
});

test("concurrent beacons are all written, one line each", async () => {
  await withCollector({ maxEventsPerMinute: 1000 }, async ({ port, dataFile, collector }) => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => post(port, body(`/p${i}`), beaconHeaders())));
    await collector.flush();
    const lines = readFileSync(dataFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 50);
    assert.ok(lines.every((l) => JSON.parse(l).h === "2026-11-04T12"));
  });
});

test("retentionDays prunes old events when the collector starts", async () => {
  const dir = tmpDir();
  const dataFile = path.join(dir, "events.jsonl");
  writeFileSync(dataFile, [{ h: "2026-06-01T10", p: "/old" }, { h: "2026-11-03T10", p: "/recent" }].map(encodeEvent).join(""));
  const collector = createCollector({ port: 0, dataFile, allowedOrigins: ["*"], retentionDays: 30, now: () => NOW });
  try {
    await collector.listen();
    await collector.flush();
    assert.deepEqual(readEvents(dataFile).map((e) => e.p), ["/recent"]);
  } finally {
    await collector.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanPath and cleanReferrer", () => {
  assert.equal(cleanPath("/a/b/?x=1"), "/a/b");
  assert.equal(cleanPath("/"), "/");
  assert.equal(cleanPath("///"), null);
  assert.equal(cleanPath("/a\u0000b"), null);
  assert.equal(cleanReferrer("javascript:alert(1)"), "");
  assert.equal(cleanReferrer("https://Sub.Example.org:8443/x?y#z"), "sub.example.org");
  assert.equal(cleanReferrer("", []), "");
  assert.equal(cleanReferrer("https://example.com/x", ["example.com"]), "");
  assert.ok(BROWSER_UA.length > 0);
});
