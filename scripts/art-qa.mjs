import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

// Uses an already-running local Chrome debugging endpoint. Never navigates or
// closes an existing user tab; only the isolated synthetic review page.
const origin = process.env.PATCH_ART_ORIGIN || "http://127.0.0.1:4173";
const cdp = process.env.PATCH_ART_CDP || "http://127.0.0.1:9222";
const output = new URL("../art/qa/", import.meta.url);
await mkdir(output, { recursive: true });
let response;
try { response = await fetch(`${cdp}/json/new?${encodeURIComponent(`${origin}/docs/art-review.html`)}`, { method: "PUT" }); }
catch { throw new Error(`Start the app and Chrome with a local remote-debugging port (default 9222). See art/README.md. Could not reach ${cdp}`); }
const target = await response.json(), ws = new WebSocket(target.webSocketDebuggerUrl);
let next = 0;
const pending = new Map(), errors = [], captures = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data), task = pending.get(message.id);
  if (task) { clearTimeout(task.timer); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
});
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
async function capture(name, options, width = 1440, height = 1050) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(`window.artReview.set(${JSON.stringify({ scene: "overview", vision: "normal", reduced: false, ...options })}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const result = await send("Page.captureScreenshot", { format: "png" });
  const bytes = Buffer.from(result.data, "base64");
  await writeFile(new URL(`${name}.png`, output), bytes);
  captures.push({ name, width, height, options, sha256: createHash("sha256").update(bytes).digest("hex") });
}
try {
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: `${origin}/docs/art-review.html` });
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    ready = await evaluate("Boolean(window.artReview)");
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "review page loaded"); await evaluate("window.artReview.ready.then(()=>true)");
  await capture("overview-desktop", {});
  await capture("overview-laptop", {}, 1024, 768);
  await capture("overview-phone", {}, 430, 932);
  await capture("overview-grayscale", { vision: "grayscale" });
  await capture("overview-deutan", { vision: "deutan" });
  for (const station of ["workbench", "research", "command", "test_dungeon", "campfire", "permission_gate", "shipping_dock"]) {
    for (const count of [1, 4]) await capture(`${station}-${count}`, { scene: "crowd", station, count });
  }
  for (const direction of ["down", "left", "right", "up"]) await capture(`walk-${direction}`, { scene: "walk", direction, time: 145 });
  await capture("reduced-motion", { reduced: true });
  const frozen = await evaluate("window.artReview.snapshot()");
  await evaluate("window.artReview.renderAt(2000)");
  assert.equal(await evaluate("window.artReview.snapshot()"), frozen, "Decorative animation must freeze under reduced motion");
  await evaluate("window.artReview.set({scene:'helpers',station:'workbench',reduced:false,time:0}); window.artReview.renderAt(2100); window.artReview.renderAt(3000)");
  const helper = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(new URL("helpers.png", output), Buffer.from(helper.data, "base64"));
  // Save the complete contact sheet directly from canvas, not a clipped viewport.
  const cast = await evaluate("document.getElementById('cast').toDataURL().split(',')[1]");
  await writeFile(new URL("family-contact-sheet.png", output), Buffer.from(cast, "base64"));
  await evaluate("window.artReview.set({scene:'crowd',station:'workbench',count:4,reduced:false,time:1000})");
  const benchmark = await evaluate("window.artReview.benchmark()");
  assert.deepEqual(errors, [], "No browser errors");
  const atlas = await readFile(new URL("../assets/sprites/familiar-atlas-v1.json", import.meta.url));
  await writeFile(new URL("report.json", output), JSON.stringify({ capturedAt: new Date().toISOString(), atlasHash: createHash("sha256").update(atlas).digest("hex"), errors, reducedMotionPixelIdentical: true, benchmark, captures, reviewStatus: "Technical checks passed. Screenshots require visual review; not a user-comprehension test." }, null, 2) + "\n");
  console.log(`Saved ${captures.length + 2} art review images. No browser errors; reduced-motion frames identical.`, benchmark);
} finally {
  await fetch(`${cdp}/json/close/${target.id}`); ws.close();
}
