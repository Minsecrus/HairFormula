#!/usr/bin/env node
/**
 * Mobile-accurate screenshot via CDP device-metrics override.
 *
 * Headless Edge's --window-size cannot produce a true narrow viewport
 * (it clamps to ~492 CSS px), so this drives an already-running Edge
 * (started with --remote-debugging-port) and emulates exact device metrics.
 *
 * Start the browser first:
 *   msedge --headless=new --remote-debugging-port=9222 \
 *     --user-data-dir=scripts/render/tmp-profile about:blank
 *
 * Usage:
 *   node scripts/cdp-shot.mjs <width> <height> <url> <out.png>
 */
import { writeFileSync } from "node:fs";

const [width, height, url, out] = process.argv.slice(2).map((v, i) =>
  i < 2 ? Number(v) : v
);
if (!width || !height || !url || !out) {
  console.error("usage: cdp-shot.mjs <w> <h> <url> <out.png>");
  process.exit(1);
}

const list = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: true,
});
await send("Page.navigate", { url });
// wait for load + give the webp/fonts a beat
await new Promise((r) => setTimeout(r, 2500));

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("wrote", out);
ws.close();
process.exit(0);
