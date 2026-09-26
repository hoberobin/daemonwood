import { WorldRenderer } from "../src/renderer.js";
import { FAMILIARS } from "../src/familiars.js";
import { AgentController, destinationByState, stationPlacards } from "../src/world-model.js";
import { animationFrame, frameRect } from "../src/art-animation.js";
import { BEHAVIOURS } from "../src/familiar-behaviour.js";

const $ = (id) => document.getElementById(id);
const renderer = new WorldRenderer($("world"));
const states = ["editing", "investigating", "running", "testing", "needs_input", "finished", "idle", "trouble", "preparing", "arriving"];
const stationState = { workbench: "editing", research: "investigating", command: "running", test_dungeon: "testing", permission_gate: "needs_input", shipping_dock: "finished", campfire: "idle" };
for (const station of stationPlacards) $("station").add(new Option(station.label, station.node));
for (const familiar of FAMILIARS) $("familiar").add(new Option(familiar.name, familiar.type));
let records = [], time = 0, playing = true, last = 0;
/* The Behaviours scene puts one familiar on each behaviour and ages them all by
   the "Time in state" slider, on a fixed wall clock, so the table in
   src/familiar-behaviour.js can be scrubbed through without waiting twenty
   minutes. The other scenes pass no clock and draw exactly as they always did. */
const BASE = Date.parse("2026-09-26T12:00:00.000Z");
const behaviourCast = [
  ["needs_input", 1, 0], ["idle", 2, 0], ["idle", 2, 1], ["editing", 3, 0], ["editing", 3, 1],
  ["arriving", 3, 2], ["trouble", 1, 0], ["finished", 1, 0], ["testing", 1, 0]
];
/* Station work: one familiar at each working station, all the same familiar
   when one is picked, so a new station sheet can be reviewed in place. */
const stationCast = ["editing", "investigating", "running", "testing"];
const toolOf = BEHAVIOURS.find((behaviour) => behaviour.id === "work.station_item").beats;
const clocked = () => ["behaviours", "stations"].includes($("scene").value);
function record(index, state, crowd = 1, slot = 0, type = null) {
  const familiar = FAMILIARS.find((candidate) => candidate.type === type) || FAMILIARS[index % FAMILIARS.length];
  const controller = new AgentController({ start: destinationByState[state], crowd, occupancySlot: slot });
  controller.state = state;
  return { key: `art-preview-${index}`, name: familiar.name, familiarType: familiar.type, controller, subagents: 0 };
}
function rebuild() {
  const scene = $("scene").value;
  if (scene === "stations") {
    const picked = $("familiar").value === "mixed" ? null : $("familiar").value;
    records = stationCast.map((state, index) => Object.assign(record(index, state, 1, 0, picked), {
      stateSince: BASE, lastEventAt: new Date(BASE).toISOString(), trail: []
    }));
    renderer.timeline.records.clear();
    renderer.timeline.update(records, 0);
    return;
  }
  if (scene === "behaviours") {
    $("age-out").value = `${$("age").value}m`;
    const age = Number($("age").value) * 60_000;
    records = behaviourCast.map(([state, crowd, slot], index) => Object.assign(record(index, state, crowd, slot), {
      agentName: FAMILIARS[index % FAMILIARS.length].name, stateSince: BASE - age, lastEventAt: new Date(BASE - age).toISOString(), trail: []
    }));
    renderer.timeline.records.clear();
    renderer.timeline.update(records, 0);
    return;
  }
  records = scene === "overview" ? states.map((state, index) => record(index, state, ["editing", "preparing", "arriving"].includes(state) ? 3 : ["running", "trouble"].includes(state) ? 2 : 1, state === "preparing" ? 1 : state === "arriving" ? 2 : state === "trouble" ? 1 : 0))
    : Array.from({ length: scene === "walk" ? 10 : scene === "helpers" ? 1 : Number($("count").value) }, (_, index) => record(index, scene === "walk" ? "editing" : stationState[$("station").value], Number($("count").value), index));
  if (scene === "walk") records.forEach((item, i) => {
    Object.assign(item.controller, { moving: true, direction: $("direction").value, position: { x: 75 + i % 5 * 88, y: 135 + Math.floor(i / 5) * 85 } });
  });
  renderer.timeline.records.clear();
  renderer.timeline.update(records, 0);
  $("description").textContent = `${scene} · ${records.length} synthetic familiar(s) · helpers follow the parent; alerts draw above foreground objects. Select grayscale to check shape rather than color.`;
}
function renderAt(elapsed) {
  time = elapsed;
  renderer.reducedMotion = $("reduced").checked;
  renderer.ambient.reducedMotion = renderer.reducedMotion;
  if ($("scene").value === "helpers") {
    records[0].subagents = elapsed < 2000 ? 0 : elapsed < 6000 ? 5 : 0;
    records[0].controller.moving = elapsed >= 3500 && elapsed < 5000;
  }
  const behaviours = $("scene").value === "behaviours";
  renderer.draw(records, elapsed, null, null, clocked() ? BASE + elapsed : undefined);
  if ($("scene").value === "stations") {
    const lines = records.map((item) => {
      const tool = toolOf[item.controller.state].hold.split("_")[0];
      const drawn = renderer.stationSprites.has(item.familiarType) ? `${tool} (station sheet)` : `no station sheet yet — ordinary frames`;
      return `${item.name} (${item.controller.state}): ${drawn}`;
    });
    $("description").textContent = `Station work · ${lines.join(" · ")}`;
  }
  if (behaviours) {
    const active = records.map((item) => `${item.name} (${item.controller.state}): ${renderer.poses.get(item.key)?.behaviours.join(", ") || "—"}`);
    $("description").textContent = `Behaviours · ${$("age").value}m in state · ${active.join(" · ")}`;
  }
  $("time").value = elapsed % 10001;
  const filter = $("vision").value === "grayscale" ? "grayscale(1)" : $("vision").value === "deutan" ? "url(#deutan)" : "none";
  $("world").style.filter = filter; $("cast").style.filter = filter;
  drawCast(elapsed);
  drawTools();
}
function drawTools() {
  const canvas = $("tools"), ctx = canvas.getContext("2d");
  if (canvas.width !== 1152) { canvas.width = 1152; canvas.height = 1280; }
  for (let y = 0; y < 1280; y += 16) for (let x = 0; x < 1152; x += 16) {
    ctx.fillStyle = (x / 16 + y / 16) % 2 ? "#34352e" : "#46483e"; ctx.fillRect(x, y, 16, 16);
  }
  FAMILIARS.forEach((familiar, row) => {
    ctx.fillStyle = "#e7ddc3"; ctx.font = "18px system-ui"; ctx.fillText(familiar.name, 8, row * 128 + 68);
    const sheet = renderer.stationSprites.get(familiar.type);
    for (let col = 0; col < 8; col++) {
      const x = 128 + col * 128, y = row * 128;
      if (sheet) {
        const frame = frameRect(col);
        ctx.drawImage(sheet, frame.x, frame.y, 128, 128, x, y, 128, 128);
      } else {
        ctx.fillStyle = "#191913"; ctx.fillRect(x + 6, y + 6, 116, 116);
        ctx.strokeStyle = "#46483e"; ctx.lineWidth = 2;
        for (let d = -116; d < 116; d += 14) { ctx.beginPath(); ctx.moveTo(x + 6 + Math.max(0, d), y + 6 + Math.max(0, -d)); ctx.lineTo(x + 6 + Math.min(116, 116 + d), y + 6 + Math.min(116, 116 - d)); ctx.stroke(); }
        if (col === 0) { ctx.fillStyle = "#b7b4a0"; ctx.font = "14px system-ui"; ctx.fillText("not drawn yet", x + 16, y + 68); }
      }
    }
  });
}
function drawCast(elapsed) {
  const canvas = $("cast"), ctx = canvas.getContext("2d");
  if (canvas.width !== 1152) { canvas.width = 1152; canvas.height = 1280; }
  for (let y = 0; y < 1280; y += 16) for (let x = 0; x < 1152; x += 16) {
    ctx.fillStyle = (x / 16 + y / 16) % 2 ? "#34352e" : "#46483e"; ctx.fillRect(x, y, 16, 16);
  }
  const poses = ["down", "left", "right", "up", "idle", "needs_input", "trouble", "finished"];
  FAMILIARS.forEach((familiar, row) => {
    ctx.fillStyle = "#e7ddc3"; ctx.font = "18px system-ui"; ctx.fillText(familiar.name, 8, row * 128 + 68);
    poses.forEach((pose, col) => {
      const frame = animationFrame({ moving: col < 4, direction: pose, state: pose }, elapsed, { reducedMotion: renderer.reducedMotion, stateAge: elapsed });
      ctx.drawImage(renderer.sprites.get(familiar.type), frame.x, frame.y, 128, 128, 128 + col * 128, row * 128, 128, 128);
    });
  });
}
$("age").addEventListener("input", () => { $("age-out").value = `${$("age").value}m`; if ($("scene").value === "behaviours") { rebuild(); renderAt(time); } });
for (const id of ["scene", "station", "count", "direction", "familiar"]) $(id).addEventListener("change", () => { time = 0; rebuild(); renderAt(time); });
for (const id of ["vision", "reduced"]) $(id).addEventListener("change", () => renderAt(time));
$("play").onclick = () => { playing = !playing; $("play").textContent = playing ? "Pause" : "Play"; };
$("time").oninput = () => { playing = false; $("play").textContent = "Play"; renderAt(Number($("time").value)); };
window.addEventListener("resize", () => { renderer.resize(); renderAt(time); });
window.artReview = {
  ready: renderer.ready,
  set(options = {}) {
    playing = false; $("play").textContent = "Play";
    for (const [key, value] of Object.entries(options)) if ($(key)) key === "reduced" ? $(key).checked = value : $(key).value = value;
    rebuild(); renderer.resize(); renderAt(options.time ?? 1000);
  },
  renderAt,
  snapshot: () => $("world").toDataURL(),
  benchmark() {
    const samples = [];
    for (let i = 0; i < 120; i++) { const start = performance.now(); renderer.draw(records, 1000 + i * 16); samples.push(performance.now() - start); }
    samples.sort((a, b) => a - b);
    return { frames: 120, medianMs: samples[60], p95Ms: samples[114], note: "Synchronous canvas submission only; not end-to-end GPU frame time" };
  },
  get records() { return records; }
};
await renderer.ready;
rebuild(); renderAt(0);
requestAnimationFrame(function tick(now) {
  if (playing) renderAt(time + Math.min(50, now - (last || now)));
  last = now; requestAnimationFrame(tick);
});
