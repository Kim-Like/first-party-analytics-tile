import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

export const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

export function tmpDir() {
  return mkdtempSync(path.join(tmpdir(), "tile-test-"));
}

/** POST to a local collector with full control over headers. */
export function post(port, body, headers = {}, urlPath = "/collect", method = "POST") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port, path: urlPath, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

export function beaconHeaders(origin = "https://example.com", extra = {}) {
  return { Origin: origin, "User-Agent": BROWSER_UA, "Content-Type": "text/plain;charset=UTF-8", ...extra };
}
