// Pageview beacon. Include with:
//   <script defer src="/beacon.js" data-endpoint="https://stats.example.com/collect"></script>
// Sends the page path (and, on the first view, the referrer) as one small POST.
// It sets no cookies, reads no storage and generates no visitor id.
(function () {
  "use strict";
  var script = document.currentScript;
  var endpoint = script && script.getAttribute("data-endpoint");
  if (!endpoint) return;

  var nav = navigator;
  // Respect Do Not Track and Global Privacy Control, and skip automated browsers.
  if (nav.doNotTrack === "1" || window.doNotTrack === "1" || nav.globalPrivacyControl === true) return;
  if (nav.webdriver) return;
  // Skip local development unless the page opts in with data-allow-local.
  if (!script.hasAttribute("data-allow-local") && /^(localhost|\[::1\])$/.test(location.hostname)) return;

  var last = null;

  function send(first) {
    var path = location.pathname;
    if (path === last) return;
    last = path;
    var body = JSON.stringify({ p: path, r: first ? document.referrer : "" });
    try {
      if (nav.sendBeacon && nav.sendBeacon(endpoint, body)) return;
    } catch (e) {}
    try {
      fetch(endpoint, { method: "POST", body: body, headers: { "Content-Type": "text/plain" }, keepalive: true, credentials: "omit", mode: "cors" });
    } catch (e) {}
  }

  function start() {
    send(true);
    // Single-page apps: count client-side navigation too.
    var push = history.pushState;
    if (push) {
      history.pushState = function () {
        var result = push.apply(this, arguments);
        send(false);
        return result;
      };
    }
    window.addEventListener("popstate", function () {
      send(false);
    });
  }

  if (document.prerendering) {
    document.addEventListener("prerenderingchange", start, { once: true });
  } else {
    start();
  }
})();
