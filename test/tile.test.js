import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../src/stats.js";
import { renderTile } from "../src/tile.js";
import { hourBucket } from "../src/store.js";
import { SAMPLE_NOW, sampleEvents } from "../fixtures/make-sample-events.mjs";

const NOW = Date.UTC(2026, 10, 4, 12, 30);
const at = (hoursAgo, p = "/", r = "") => ({ h: hourBucket(NOW - hoursAgo * 3600 * 1000), p, r });
const render = (events, opts) => renderTile(computeStats(events, { now: NOW }), { generatedAt: new Date(NOW), ...opts });

test("tile shows total, change, top pages and referrers", () => {
  const html = renderTile(computeStats(sampleEvents(), { now: SAMPLE_NOW }), { generatedAt: new Date(SAMPLE_NOW) });
  assert.match(html, /<div class="big">290<\/div>/);
  assert.match(html, /Up 29% from 224 in the previous 7 days/);
  assert.match(html, /\/guides\/getting-started/);
  assert.match(html, /search\.example\.org/);
  assert.match(html, /<td class="num">new<\/td>/);
  assert.match(html, /Generated 2026-11-04 12:30 UTC/);
});

test("the page is self-contained: no scripts, no links, no external requests", () => {
  const html = render([at(1, "/a", "x.example.org")]);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/\b(src|href)=/i.test(html));
  assert.ok(!/https?:\/\//i.test(html));
  assert.match(html, /default-src 'none'/);
});

test("paths from the internet are escaped", () => {
  const evil = '/<script>alert(1)</script>"onmouseover="x';
  const html = render([at(1, evil), at(1, "/it's&co", 'bad"host.example.org')]);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&quot;onmouseover=&quot;x"));
  assert.ok(html.includes("/it&#39;s&amp;co"));
  assert.ok(!html.includes('bad"host'));
  const titled = render([at(1)], { title: "<b>x</b>" });
  assert.ok(!titled.includes("<b>x</b>"));
});

test("change wording covers down, flat, no earlier data and empty", () => {
  const down = render([at(1), at(7 * 24 + 1), at(7 * 24 + 2), at(7 * 24 + 3)]);
  assert.match(down, /class="change down">▼ Down 67% from 3 in the previous 7 days/);
  const flat = render([at(1), at(7 * 24 + 1)]);
  assert.match(flat, /No change from 1 in the previous 7 days/);
  const fresh = render([at(1)]);
  assert.match(fresh, /No views in the previous 7 days to compare with/);
  assert.match(fresh, /Data starts after the beginning of the previous period/);
  const empty = render([]);
  assert.match(empty, /No views in the last 7 days or the 7 days before/);
  assert.match(empty, /No views yet/);
});

test("the sparkline has a text alternative with every daily value", () => {
  const html = render([at(1), at(1), at(30)]);
  assert.match(html, /role="img" aria-label="Views per day, oldest to newest: 0, 0, 0, 0, 0, 1, 2"/);
});

test("pages beyond the limit are acknowledged", () => {
  const events = ["/a", "/b", "/c"].map((p) => at(1, p));
  const html = renderTile(computeStats(events, { now: NOW, top: 2 }), { generatedAt: new Date(NOW) });
  assert.match(html, /Showing 2 of 3 pages/);
});
