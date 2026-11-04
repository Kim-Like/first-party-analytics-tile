import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { encodeEvent, hourBucket, pruneFile, readEvents } from "../src/store.js";
import { computeStats } from "../src/stats.js";
import { SAMPLE_NOW, sampleEvents } from "../fixtures/make-sample-events.mjs";
import { tmpDir } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 4, 12, 30);
const at = (hoursAgo, p = "/", r = "") => ({ h: hourBucket(NOW - hoursAgo * 3600 * 1000), p, r });

test("hourBucket is the UTC hour and nothing finer", () => {
  assert.equal(hourBucket(Date.UTC(2026, 0, 2, 3, 59, 59)), "2026-01-02T03");
});

test("readEvents skips junk lines and missing files", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "e.jsonl");
    assert.deepEqual(readEvents(file), []);
    writeFileSync(file, [encodeEvent({ h: "2026-11-04T10", p: "/a", r: "x.example.org" }).trim(), "not json", '{"h":"bad","p":"/b"}', '{"h":"2026-11-04T11"}', "", encodeEvent({ h: "2026-11-04T11", p: "/c" }).trim()].join("\n"));
    assert.deepEqual(readEvents(file), [
      { h: "2026-11-04T10", p: "/a", r: "x.example.org" },
      { h: "2026-11-04T11", p: "/c", r: "" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("encodeEvent writes only hour, path and optional referrer host", () => {
  assert.equal(encodeEvent({ h: "2026-11-04T10", p: "/a", r: "" }), '{"h":"2026-11-04T10","p":"/a"}\n');
});

test("pruneFile removes events older than the retention window", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "e.jsonl");
    writeFileSync(file, [at(24 * 40), at(24 * 31), at(24 * 29), at(1)].map(encodeEvent).join(""));
    assert.deepEqual(pruneFile(file, { days: 30, now: NOW }), { kept: 2, removed: 2 });
    assert.equal(readEvents(file).length, 2);
    assert.deepEqual(pruneFile(file, { days: 30, now: NOW }), { kept: 2, removed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeStats compares the window with the one before it", () => {
  const events = [at(1), at(2), at(3), at(7 * 24 + 1), at(7 * 24 + 5), at(14 * 24 + 5)];
  const s = computeStats(events, { days: 7, now: NOW });
  assert.equal(s.total, 3);
  assert.equal(s.previousTotal, 2);
  assert.equal(s.changePct, 50);
});

test("window edges: the current hour is included, events past 2 windows are not", () => {
  const s = computeStats([at(0), at(7 * 24 - 1), at(7 * 24), at(14 * 24 - 1), at(14 * 24)], { days: 7, now: NOW });
  assert.equal(s.total, 2);
  assert.equal(s.previousTotal, 2);
});

test("percent change is null when the previous period was empty", () => {
  const s = computeStats([at(1)], { now: NOW });
  assert.equal(s.changePct, null);
  assert.equal(s.previousIncomplete, true);
});

test("no data at all", () => {
  const s = computeStats([], { now: NOW });
  assert.equal(s.total, 0);
  assert.equal(s.topPages.length, 0);
  assert.equal(s.daily.length, 7);
  assert.equal(s.previousIncomplete, true);
});

test("daily buckets add up to the total and are zero-filled", () => {
  const s = computeStats([at(1), at(1), at(30)], { days: 3, now: NOW });
  assert.equal(s.daily.length, 3);
  assert.equal(s.daily.reduce((n, d) => n + d.views, 0), s.total);
  assert.deepEqual(s.daily.map((d) => d.views), [0, 1, 2]);
});

test("top pages carry per-page change and respect the limit", () => {
  const events = [
    ...Array.from({ length: 4 }, () => at(1, "/a")),
    ...Array.from({ length: 2 }, () => at(7 * 24 + 1, "/a")),
    at(2, "/b"), at(2, "/c"), at(2, "/new"),
  ];
  const s = computeStats(events, { now: NOW, top: 2 });
  assert.equal(s.topPages.length, 2);
  assert.equal(s.pageCount, 4);
  assert.deepEqual(s.topPages[0], { path: "/a", views: 4, previous: 2, change: 2, changePct: 100, share: 57 });
  assert.equal(s.topPages[1].path, "/b");
  assert.equal(s.topPages[1].changePct, null);
});

test("referrers are counted for the current window only", () => {
  const s = computeStats([at(1, "/", "a.example.org"), at(1, "/", "a.example.org"), at(1, "/", "b.example.org"), at(7 * 24 + 1, "/", "c.example.org"), at(1)], { now: NOW });
  assert.deepEqual(s.topReferrers, [{ host: "a.example.org", views: 2 }, { host: "b.example.org", views: 1 }]);
});

test("the sample events file is in sync with its generator", () => {
  const file = new URL("../fixtures/events.sample.jsonl", import.meta.url);
  assert.equal(readFileSync(file, "utf8"), sampleEvents().map(encodeEvent).join(""));
  const s = computeStats(sampleEvents(), { now: SAMPLE_NOW });
  assert.equal(s.previousIncomplete, false);
  assert.ok(s.total > 0 && s.previousTotal > 0);
});
