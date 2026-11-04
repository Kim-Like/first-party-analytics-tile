import http from "node:http";
import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import * as path from "node:path";
import { encodeEvent, hourBucket, pruneFile } from "./store.js";

const BODY_LIMIT = 2048;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests|httpx/i;

export const COLLECTOR_DEFAULTS = {
  port: 8787,
  host: "localhost",
  endpoint: "/collect",
  dataFile: "./data/events.jsonl",
  allowedOrigins: [],
  ignoreBots: true,
  maxEventsPerMinute: 600,
  retentionDays: 0,
};

/** Page path from the beacon: no query string, no fragment, no control characters. */
export function cleanPath(value) {
  if (typeof value !== "string") return null;
  let s = value.trim();
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  if (!s.startsWith("/") || s.startsWith("//") || s.length > 200) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(s)) return null;
  if (s.length > 1) s = s.replace(/\/+$/, "") || "/";
  return s;
}

/** Referrer reduced to a bare host name, or "" when missing, invalid or not http(s). */
export function cleanReferrer(value, ownHosts = []) {
  if (typeof value !== "string" || !value || value.length > 500) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!host || host.length > 100 || ownHosts.includes(host)) return "";
  return host;
}

function hostOf(origin) {
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Create (but do not start) a collector.
 * Nothing about the visitor is stored: no address, no user agent, no identifier.
 * The user agent header is read once to skip obvious bots and then dropped.
 */
export function createCollector(options = {}) {
  const cfg = { ...COLLECTOR_DEFAULTS, ...options };
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? (() => {});
  const wildcard = cfg.allowedOrigins.includes("*");
  const origins = new Set(cfg.allowedOrigins.filter((o) => o !== "*").map((o) => o.replace(/\/+$/, "")));
  const ownHosts = [...origins].map(hostOf).filter(Boolean);
  if (!wildcard && origins.size === 0) {
    throw new Error('allowedOrigins is required: list your site origins, or use ["*"] to accept any origin');
  }

  mkdirSync(path.dirname(path.resolve(cfg.dataFile)), { recursive: true });

  let queue = Promise.resolve();
  const enqueue = (job) => {
    queue = queue.then(job).catch((err) => log(`write failed: ${err.message}`));
    return queue;
  };

  let windowStart = 0;
  let windowCount = 0;
  const underRateLimit = () => {
    const minute = Math.floor(now() / 60000);
    if (minute !== windowStart) {
      windowStart = minute;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount <= cfg.maxEventsPerMinute;
  };

  const originAllowed = (origin) => wildcard || (typeof origin === "string" && origins.has(origin));

  function send(res, status, headers = {}, body = "") {
    res.writeHead(status, {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(body);
  }

  function corsHeaders(origin) {
    if (!originAllowed(origin)) return {};
    return { "Access-Control-Allow-Origin": wildcard ? "*" : origin, Vary: "Origin" };
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on("data", (chunk) => {
        if (failed) return;
        size += chunk.length;
        if (size > limit) {
          failed = true;
          chunks.length = 0;
          reject(Object.assign(new Error("body too large"), { status: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && pathname === "/health") return send(res, 200, { "Content-Type": "text/plain" }, "ok\n");
    if (pathname !== cfg.endpoint) return send(res, 404);

    const origin = req.headers.origin;
    if (req.method === "OPTIONS") {
      return send(res, 204, {
        ...corsHeaders(origin),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
    }
    if (req.method !== "POST") return send(res, 405, { Allow: "POST, OPTIONS" });
    if (!originAllowed(origin)) return send(res, 403);

    let payload;
    try {
      payload = JSON.parse(await readBody(req, BODY_LIMIT));
    } catch (err) {
      return send(res, err.status ?? 400, { ...corsHeaders(origin), Connection: "close" });
    }

    const headers = corsHeaders(origin);
    // Visitors who signal "do not track" or "global privacy control" are not counted.
    if (req.headers.dnt === "1" || req.headers["sec-gpc"] === "1") return send(res, 204, headers);
    const ua = req.headers["user-agent"];
    if (cfg.ignoreBots && (!ua || BOT_RE.test(ua))) return send(res, 204, headers);

    const p = cleanPath(payload?.p);
    if (!p) return send(res, 400, headers);
    if (!underRateLimit()) return send(res, 429, headers);

    const event = { h: hourBucket(now()), p, r: cleanReferrer(payload?.r, ownHosts) };
    enqueue(() => appendFile(cfg.dataFile, encodeEvent(event)));
    return send(res, 204, headers);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`request failed: ${err.message}`);
      if (!res.headersSent) send(res, 500);
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;

  let pruneTimer = null;
  const prune = () => enqueue(() => {
    const result = pruneFile(cfg.dataFile, { days: cfg.retentionDays, now: now() });
    if (result.removed) log(`pruned ${result.removed} events older than ${cfg.retentionDays} days`);
  });

  return {
    server,
    config: cfg,
    prune,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port: cfg.port, host: cfg.host }, () => {
          server.off("error", reject);
          if (cfg.retentionDays > 0) {
            prune();
            pruneTimer = setInterval(prune, 24 * 3600 * 1000);
            pruneTimer.unref();
          }
          resolve(server.address());
        });
      });
    },
    async close() {
      if (pruneTimer) clearInterval(pruneTimer);
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
      await queue;
    },
    /** Resolves when every accepted event has been written. */
    flush: () => queue,
  };
}
