# First Party Analytics Tile: usage

A small pageview counter you host yourself. Three parts:

1. `src/beacon.js`, a browser script that sends the page path when a page loads.
2. A collector (`serve`) that receives those beacons and appends one line per view to a local file.
3. A tile (`tile`) that reads the file and writes one static HTML page: views, top pages, and the change against the previous period.

Requires Node 20 or newer. There are no dependencies to install.

## What is stored

Each line in the events file looks like this:

```json
{"h":"2026-11-04T18","p":"/guides/start","r":"search.example.org"}
```

That is the UTC hour, the page path without query string or fragment, and, when the visitor arrived from another site, the referrer host name only. Nothing else: no IP address, no user agent, no cookie, no visitor or session id. The user agent header is read once to skip obvious bots and is not kept. Because there is no visitor id, the tile counts views, not unique visitors.

## Install and run

```bash
git clone https://github.com/Kim-Like/first-party-analytics-tile.git
cd first-party-analytics-tile
npm test
```

Write a collector config (JSON, no environment variables):

```json
{
  "port": 8787,
  "dataFile": "./data/events.jsonl",
  "allowedOrigins": ["https://example.com"],
  "retentionDays": 90
}
```

Start it:

```bash
$ node src/cli.js serve --config collector.json
collector listening on http://localhost:8787/collect
```

Add the beacon to your pages. Copy `src/beacon.js` to your site and point it at the collector:

```html
<script defer src="/beacon.js" data-endpoint="https://stats.example.com/collect"></script>
```

Build the tile whenever you like, for example from a scheduled job:

```bash
$ node src/cli.js tile --data ./data/events.jsonl --out ./public/tile.html --title "example.com"
```

It prints one line saying how many views the current and previous periods contain (see the example below).

## Collector options (`serve --config`)

| Key | Default | Meaning |
|---|---|---|
| `allowedOrigins` | none, required | Origins allowed to send beacons, for example `["https://example.com"]`. `["*"]` accepts any origin. Anything else gets a 403. |
| `port` | `8787` | Port to listen on. `0` picks a free one. |
| `host` | `"localhost"` | Interface to bind. Put a TLS reverse proxy in front for a public endpoint. |
| `endpoint` | `"/collect"` | Path that accepts beacons. `/health` answers `ok`. |
| `dataFile` | `"./data/events.jsonl"` | Events file. The folder is created if needed. |
| `ignoreBots` | `true` | Do not count requests whose user agent looks like a crawler, a preview fetcher or a command line client, or has no user agent. |
| `maxEventsPerMinute` | `600` | Global cap across all visitors. Beacons over the cap get a 429 and are not stored. |
| `retentionDays` | `0` | When above 0, events older than this are deleted at start and once a day. `0` keeps everything. |

What the collector does with a beacon, in order: refuses unlisted origins, drops requests that send Do Not Track or Global Privacy Control, drops bots, validates the path (must start with `/`, at most 200 characters, no spaces or control characters), applies the rate cap, then writes the line. Requests dropped for privacy or bot reasons still get a 204, so the page sees no error.

## Beacon behaviour

The script sends the path on load, using `sendBeacon` with a `fetch` fallback, and sends the referrer only on the first view. It also counts client-side navigation in single-page apps (`pushState` and back/forward). It does nothing when `data-endpoint` is missing, when the browser says Do Not Track or Global Privacy Control, when the browser reports automation, and on `localhost` (add `data-allow-local` to test locally).

## Tile options (`tile`)

| Flag | Default | Meaning |
|---|---|---|
| `--data <file>` | required | Events file. Lines that do not parse are ignored. |
| `--out <file>` | required | HTML file to write. |
| `--days <n>` | `7` | Length of the period. It is compared with the `n` days before it, in whole UTC hours. |
| `--top <n>` | `10` | Number of pages listed. |
| `--title <text>` | `Page views` | Heading. |
| `--now <ISO time>` | current time | Pin the clock to reproduce a report, for example `2026-11-04T12:30:00Z`. |

The page is self-contained: inline styles, an inline SVG chart with a text alternative, no scripts, no external requests, and a content security policy that blocks them. Page paths come from the open internet, so every value is escaped. If the data starts after the beginning of the previous period, the tile says the comparison covers less time.

## Example

The repository includes made-up traffic for an example site (`fixtures/events.sample.jsonl`, rebuilt by `node fixtures/make-sample-events.mjs <file>`):

```bash
$ node src/cli.js tile --data fixtures/events.sample.jsonl --out tile.html \
    --title "example.com" --now 2026-11-04T12:30:00Z
wrote tile.html: 290 views in 7 days, 224 in the days before
```

The tile shows 290 views, "Up 29% from 224 in the previous 7 days", a daily chart, and a table such as:

```
Page                      Views  Share  vs previous
/                           119    41%  +17 (+17%)
/guides/getting-started      67    23%  +3 (+5%)
/guides/pricing-basics       42    14%  +4 (+11%)
/about                       25     9%  +13 (+108%)
/blog/launch-notes           24     8%  new
/contact                     13     4%  +5 (+63%)
```

A real beacon sent to a running collector with curl (one allowed origin, one not):

```
$ curl -i -X POST http://localhost:8787/collect -H 'Origin: https://example.com' \
    -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64)' \
    --data '{"p":"/guides/start?utm=x#top","r":"https://search.example.org/results?q=abc"}'
HTTP/1.1 204 No Content
Cache-Control: no-store
X-Content-Type-Options: nosniff
Access-Control-Allow-Origin: https://example.com
Vary: Origin

$ curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/collect \
    -H 'Origin: https://evil.example.org' --data '{"p":"/"}'
403

$ cat data/events.jsonl
{"h":"2026-11-04T18","p":"/guides/start","r":"search.example.org"}
```

Note that the query string and fragment are gone and the referrer is a bare host name.

## Things to know before you rely on it

- The collector stores no IP address, but the web server or reverse proxy in front of it may log one. Check that logging if the point is to keep addresses out of your systems.
- The origin check stops other websites from sending beacons from a browser. It does not stop someone sending requests with a forged `Origin` header from a script. The per-minute cap limits the damage, but anyone can inflate your numbers or add fake page paths. This is a trend indicator, not an audit trail.
- Without a visitor id, a reload counts as a second view and there is no unique visitor count, no sessions and no bounce rate. That is deliberate.
- Do Not Track and Global Privacy Control are respected in the browser and, when sent as headers, by the collector.
- Whether you need a cookie notice depends on your jurisdiction and on what you do with the data. This tool does not give legal advice.

## When NOT to use this

- You need unique visitors, funnels, conversions, campaign attribution or session replay. This counts page views by path and hour, nothing more.
- You need numbers you can defend, for example to bill an advertiser. They can be inflated by anyone who can reach the endpoint (see above), and bot filtering is a simple user agent check.
- Your site has heavy traffic. The collector is one Node process appending to one file, and the tile reads the whole file into memory. It suits small sites; if building the tile gets slow, you have outgrown it and should use a real database.
- You run several collector processes against one file. Appends from one process are queued; the retention cleanup rewrites the file and assumes a single writer.
- You want a hosted dashboard with accounts and sharing. The tile is one static page you serve yourself.
