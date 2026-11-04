import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../src/beacon.js", import.meta.url), "utf8");

/** Run the beacon in a fake browser and return what it did. */
function run({ endpoint = "https://stats.example.com/collect", pathname = "/page", host = "www.example.com", referrer = "https://search.example.org/?q=1", nav = {}, attrs = {}, prerendering = false, beaconOk = true } = {}) {
  const sent = [];
  const fetched = [];
  const listeners = {};
  const cookieWrites = [];
  const script = {
    getAttribute: (n) => (n === "data-endpoint" ? endpoint : null),
    hasAttribute: (n) => n in attrs,
  };
  const document = {
    currentScript: script,
    referrer,
    prerendering,
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  Object.defineProperty(document, "cookie", { set: (v) => cookieWrites.push(v), get: () => "" });
  const location = { pathname, hostname: host };
  const history = { pushState() { return "pushed"; } };
  const window = { addEventListener: (type, fn) => (listeners[type] = fn) };
  const navigator = { sendBeacon: (url, body) => (sent.push({ url, body }), beaconOk), ...nav };
  const ctx = { document, location, history, navigator, window, fetch: (url, init) => fetched.push({ url, init }), JSON };
  vm.runInNewContext(SOURCE, ctx);
  return { sent, fetched, listeners, cookieWrites, location, history, document };
}

test("sends the path and referrer once with sendBeacon", () => {
  const { sent } = run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://stats.example.com/collect");
  assert.deepEqual(JSON.parse(sent[0].body), { p: "/page", r: "https://search.example.org/?q=1" });
});

test("sets no cookies", () => {
  assert.deepEqual(run().cookieWrites, []);
});

test("falls back to fetch with keepalive and no credentials", () => {
  const { sent, fetched } = run({ beaconOk: false });
  assert.equal(sent.length, 1);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].init.keepalive, true);
  assert.equal(fetched[0].init.credentials, "omit");
  assert.equal(fetched[0].init.headers["Content-Type"], "text/plain");
});

test("does nothing without an endpoint", () => {
  assert.equal(run({ endpoint: "" }).sent.length, 0);
});

test("respects Do Not Track, Global Privacy Control and automation", () => {
  assert.equal(run({ nav: { doNotTrack: "1" } }).sent.length, 0);
  assert.equal(run({ nav: { globalPrivacyControl: true } }).sent.length, 0);
  assert.equal(run({ nav: { webdriver: true } }).sent.length, 0);
});

test("skips localhost unless the page opts in", () => {
  assert.equal(run({ host: "localhost" }).sent.length, 0);
  assert.equal(run({ host: "localhost", attrs: { "data-allow-local": "" } }).sent.length, 1);
});

test("single-page navigation sends the new path, not the referrer, and not the same path twice", () => {
  const r = run();
  r.location.pathname = "/next";
  assert.equal(r.history.pushState(), "pushed");
  assert.equal(r.sent.length, 2);
  assert.deepEqual(JSON.parse(r.sent[1].body), { p: "/next", r: "" });
  r.history.pushState();
  assert.equal(r.sent.length, 2);
  r.location.pathname = "/page";
  r.listeners.popstate();
  assert.equal(r.sent.length, 3);
});

test("waits for a prerendered page to become visible", () => {
  const r = run({ prerendering: true });
  assert.equal(r.sent.length, 0);
  r.listeners.prerenderingchange();
  assert.equal(r.sent.length, 1);
});
