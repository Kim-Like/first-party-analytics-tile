import { HOUR_MS, hourBucket, hourStartMs } from "./store.js";

function pctChange(current, previous) {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function topN(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit);
}

/**
 * Compare the last `days` days with the `days` days before them, in whole UTC hours.
 * The current window ends at the end of the hour containing `now`.
 */
export function computeStats(events, { days = 7, now = Date.now(), top = 10, topReferrers = 5 } = {}) {
  const dayMs = 24 * HOUR_MS;
  const end = hourStartMs(hourBucket(now)) + HOUR_MS;
  const start = end - days * dayMs;
  const prevStart = start - days * dayMs;

  const pages = new Map();
  const previousPages = new Map();
  const referrers = new Map();
  const daily = Array.from({ length: days }, (_, i) => ({
    from: hourBucket(start + i * dayMs),
    views: 0,
  }));
  let total = 0;
  let previousTotal = 0;
  let earliest = null;

  for (const e of events) {
    const t = hourStartMs(e.h);
    if (earliest === null || t < earliest) earliest = t;
    if (t >= start && t < end) {
      total += 1;
      pages.set(e.p, (pages.get(e.p) ?? 0) + 1);
      if (e.r) referrers.set(e.r, (referrers.get(e.r) ?? 0) + 1);
      daily[Math.floor((t - start) / dayMs)].views += 1;
    } else if (t >= prevStart && t < start) {
      previousTotal += 1;
      previousPages.set(e.p, (previousPages.get(e.p) ?? 0) + 1);
    }
  }

  return {
    days,
    window: { from: hourBucket(start), to: hourBucket(end - HOUR_MS) },
    total,
    previousTotal,
    changePct: pctChange(total, previousTotal),
    previousIncomplete: earliest === null || earliest > prevStart,
    topPages: topN(pages, top).map(([path, views]) => {
      const previous = previousPages.get(path) ?? 0;
      return {
        path,
        views,
        previous,
        change: views - previous,
        changePct: pctChange(views, previous),
        share: total ? Math.round((views / total) * 100) : 0,
      };
    }),
    topReferrers: topN(referrers, topReferrers).map(([host, views]) => ({ host, views })),
    daily,
    pageCount: pages.size,
  };
}
