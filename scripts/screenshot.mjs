import { writeFileSync } from "node:fs";
/* Usage: screenshot.mjs <url> <out.png> [width] [height] [waitMs] [jsToRunFirst]
   The trailing expression runs in the page after the wait and before capture,
   which is how drawer-open and other interactive states get photographed. */
const [,, url, out, width = "1440", height = "900", waitMs = "6000", action = ""] = process.argv;
const res = await fetch("http://127.0.0.1:9222/json/new?" + encodeURIComponent(url), { method: "PUT" });
const target = await res.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const problems = [];
const send = (method, params = {}) => new Promise((resolve) => {
  const msgId = ++id;
  pending.set(msgId, resolve);
  ws.send(JSON.stringify({ id: msgId, method, params }));
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
  /* Real page errors, not a global the page never sets. A blank canvas is
     usually an exception that killed the animation loop. */
  if (msg.method === "Runtime.exceptionThrown") {
    const details = msg.params.exceptionDetails;
    problems.push(details.exception?.description || details.text || "exception");
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    problems.push(msg.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
  }
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(width), height: Number(height), deviceScaleFactor: 2, mobile: false
});
await new Promise((r) => setTimeout(r, Number(waitMs)));
if (action) {
  await send("Runtime.evaluate", { expression: action, awaitPromise: true });
  await new Promise((r) => setTimeout(r, 600));
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("page errors:", problems.length ? `\n  ${problems.join("\n  ")}` : "none");
await fetch(`http://127.0.0.1:9222/json/close/${target.id}`);
ws.close();
console.log("saved", out);
