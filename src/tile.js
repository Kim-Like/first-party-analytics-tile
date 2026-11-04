const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (n) => n.toLocaleString("en-US");

function changeText(stats) {
  const d = stats.days;
  if (stats.previousTotal === 0) {
    return stats.total === 0
      ? { cls: "flat", text: `No views in the last ${d} days or the ${d} days before.` }
      : { cls: "flat", text: `No views in the previous ${d} days to compare with.` };
  }
  const diff = stats.total - stats.previousTotal;
  const base = `${fmt(stats.previousTotal)} in the previous ${d} days`;
  if (diff === 0) return { cls: "flat", text: `No change from ${base}.` };
  const dir = diff > 0 ? "Up" : "Down";
  return {
    cls: diff > 0 ? "up" : "down",
    text: `${diff > 0 ? "▲" : "▼"} ${dir} ${Math.abs(stats.changePct)}% from ${base}.`,
  };
}

function pageChange(page) {
  if (page.changePct === null) return page.views > 0 ? "new" : "";
  if (page.change === 0) return "same";
  return `${page.change > 0 ? "+" : "-"}${Math.abs(page.change)} (${page.changePct > 0 ? "+" : "-"}${Math.abs(page.changePct)}%)`;
}

function sparkline(daily) {
  const w = 320;
  const h = 64;
  const pad = 4;
  const max = Math.max(1, ...daily.map((d) => d.views));
  const step = daily.length > 1 ? (w - pad * 2) / (daily.length - 1) : 0;
  const pts = daily.map((d, i) => [pad + i * step, h - pad - (d.views / max) * (h - pad * 2)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${(pad + (daily.length - 1) * step).toFixed(1)},${h - pad}`;
  const label = `Views per day, oldest to newest: ${daily.map((d) => d.views).join(", ")}`;
  const dots = pts
    .map(([x, y], i) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5"><title>${esc(daily[i].from)}:00 UTC onward, 24 hours: ${daily[i].views} views</title></circle>`)
    .join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><polygon class="area" points="${area}"/><polyline class="line" points="${line}" fill="none"/>${dots}</svg>`;
}

/**
 * Render one self-contained HTML page: no scripts, no external requests.
 * Every dynamic value is escaped, because page paths come from the open internet.
 */
export function renderTile(stats, { title = "Page views", generatedAt = new Date() } = {}) {
  const change = changeText(stats);
  const rows = stats.topPages.length
    ? stats.topPages
        .map((p) => `<tr><td class="path">${esc(p.path)}</td><td class="num">${fmt(p.views)}</td><td class="num">${p.share}%</td><td class="num">${esc(pageChange(p))}</td></tr>`)
        .join("")
    : `<tr><td colspan="4" class="empty">No views yet.</td></tr>`;
  const refs = stats.topReferrers.length
    ? `<h2>Top referrers</h2><ul class="refs">${stats.topReferrers.map((r) => `<li><span>${esc(r.host)}</span><span class="num">${fmt(r.views)}</span></li>`).join("")}</ul>`
    : "";
  const note = stats.previousIncomplete && stats.total > 0
    ? `<p class="note">Data starts after the beginning of the previous period, so the comparison covers less time than the current one.</p>`
    : "";
  const more = stats.pageCount > stats.topPages.length ? ` Showing ${stats.topPages.length} of ${fmt(stats.pageCount)} pages.` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c2330;--muted:#5b6575;--line:#e2e6ec;--accent:#2d5aa0;--up:#1b7a46;--down:#b3402a}
@media (prefers-color-scheme:dark){:root{--bg:#141922;--fg:#e8ecf2;--muted:#9aa5b5;--line:#2a3140;--accent:#7fa6e0;--up:#5fcf8f;--down:#f08a74}}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
.tile{max-width:460px;border:1px solid var(--line);border-radius:12px;padding:20px}
h1{font-size:15px;font-weight:600;margin:0 0 4px;color:var(--muted)}
h2{font-size:13px;font-weight:600;margin:20px 0 6px;color:var(--muted)}
.big{font-size:40px;font-weight:700;line-height:1.1}
.sub{color:var(--muted);margin:0 0 6px}
.change{margin:4px 0 12px;font-weight:600}.up{color:var(--up)}.down{color:var(--down)}.flat{color:var(--muted)}
.spark{width:100%;height:auto;display:block}.spark .line{stroke:var(--accent);stroke-width:2}.spark .area{fill:var(--accent);opacity:.12}.spark circle{fill:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-weight:600;color:var(--muted);padding:4px 0;border-bottom:1px solid var(--line)}
td{padding:4px 0;border-bottom:1px solid var(--line)}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:8px}th.num{text-align:right}
.path{word-break:break-all}.empty,.note,.foot{color:var(--muted);font-size:13px}
.refs{list-style:none;margin:0;padding:0}.refs li{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line);font-size:14px}
.foot{margin:16px 0 0}
</style>
</head>
<body>
<main class="tile">
<h1>${esc(title)}</h1>
<div class="big">${fmt(stats.total)}</div>
<p class="sub">views in the last ${stats.days} days</p>
<p class="change ${change.cls}">${esc(change.text)}</p>
${sparkline(stats.daily)}
<h2>Top pages</h2>
<table>
<thead><tr><th>Page</th><th class="num">Views</th><th class="num">Share</th><th class="num">vs previous</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${refs}
${note}
<p class="foot">Generated ${esc(generatedAt.toISOString().slice(0, 16).replace("T", " "))} UTC.${esc(more)} Counts page paths and hours only.</p>
</main>
</body>
</html>
`;
}
