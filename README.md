# First Party Analytics Tile

Most of my small sites do not need a surveillance stack. I want to know whether anyone read last week's article, which pages carry the traffic, and whether this week is up or down. A full analytics suite answers that and a hundred other questions, and in exchange it sets cookies, ships visitor data to someone else and asks for a banner.

This is the small version. A browser script sends the page path when a page loads. A minimal Node collector receives it and appends one line to a local file: the UTC hour, the path without its query string, and the referrer host name if there was one. No IP address, no user agent, no cookie, no visitor id. A second command reads that file and writes one static HTML tile with the view count, a daily chart, the top pages and the change against the previous period.

It is deliberately blunt. With no visitor id there are no unique visitors, sessions or funnels. Anyone who can reach the endpoint can add fake views, so treat the numbers as a trend, not an audit. The collector does not store IP addresses, but your reverse proxy might log them, and the docs say so. The script honours Do Not Track and Global Privacy Control.

## Quick start

```bash
git clone https://github.com/Kim-Like/first-party-analytics-tile.git && cd first-party-analytics-tile
node src/cli.js serve --config collector.json
node src/cli.js tile --data ./data/events.jsonl --out tile.html
```

The config format, the beacon snippet, example output and when not to use it are in [docs/USAGE.md](./docs/USAGE.md).

I write about running AI systems in production at [aienterprise.dk](https://aienterprise.dk).

## What it does

Shows lightweight page views, top pages, and recent movement without sending visitor data to a third-party dashboard.

## Install and use

See the files in this repository for the current runnable shape. This tool was rebuilt from scratch as a generic public utility, not copied from a production system.

## License

MIT. See [LICENSE](./LICENSE).

## Author

Kim Like, https://aienterprise.dk
