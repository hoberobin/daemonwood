import { ambient, environment, signals } from "./design/tokens.js";
import { FIRE, withAlpha } from "./effects.js";

// Editable source-space masks. These reuse pixels from the preserved master;
// they are foreground cutouts, not a claim to have recovered the painting.
export const foreground = Object.freeze([
  { id: "gate-left-post", depth: 219, polygon: [[56, 208], [62, 208], [64, 224], [57, 225]] },
  { id: "gate-right-post", depth: 219, polygon: [[136, 209], [142, 210], [143, 224], [136, 224]] },
  { id: "dock-post-west", depth: 240, polygon: [[330, 223], [336, 223], [338, 244], [331, 245]] },
  { id: "dock-post-east", depth: 240, polygon: [[454, 224], [460, 224], [461, 242], [454, 243]] }
]);

export function drawForeground(context, plate, mask, view) {
  const { scale, x, y } = view;
  context.save(); context.beginPath();
  mask.polygon.forEach(([px, py], index) => context[index ? "lineTo" : "moveTo"](x + px * scale, y + py * scale));
  context.closePath(); context.clip();
  context.drawImage(plate, x, y, 512 * scale, 288 * scale);
  context.restore();
}

export function occupiedStations(records) {
  const stations = new Map();
  for (const record of records) {
    const agent = record.controller;
    if (agent.moving || agent.leaving || agent.currentNode !== agent.destination) continue;
    if (!stations.has(agent.currentNode)) stations.set(agent.currentNode, []);
    stations.get(agent.currentNode).push(record);
  }
  return stations;
}

export class StationArt {
  draw(context, view, records, elapsed, timeline, reducedMotion) {
    const t = reducedMotion ? 0 : elapsed / 1000;
    context.save(); context.translate(view.x, view.y); context.scale(view.scale, view.scale);
    context.lineWidth = 0.6;
    for (const [station, workers] of occupiedStations(records)) {
      if (station === "workbench" && workers.some((worker) => worker.controller.state === "editing")) {
        // Tiny sparks at the painted vice, never over a face.
        context.fillStyle = environment.lamp;
        for (let i = 0; i < 3; i++) {
          const life = (t * 0.65 + i / 3) % 1;
          context.globalAlpha = reducedMotion ? 0.5 : Math.sin(life * Math.PI) * 0.65;
          context.fillRect(126 + i * 1.5, 51 - life * 4, 0.7, 0.7);
        }
      } else if (station === "research") {
        context.globalAlpha = 0.8;
        context.fillStyle = environment.bloom;
        const page = reducedMotion ? 2 : 1.8 + Math.sin(t * 0.9) * 1.4;
        context.beginPath(); context.moveTo(235, 47); context.lineTo(235 + page, 44.8); context.lineTo(239, 47.3); context.closePath(); context.fill();
      } else if (station === "command") {
        context.globalAlpha = 0.8;
        const trouble = workers.some((record) => record.controller.state === "trouble");
        context.strokeStyle = trouble ? signals.trouble : signals.running;
        context.strokeRect(310, 37, 14, 8);
        context.fillStyle = context.strokeStyle;
        const sweep = reducedMotion ? 4 : (t * 2) % 7;
        context.globalAlpha = 0.4; context.fillRect(311, 37 + sweep, 12, 0.7);
      } else if (station === "test_dungeon") {
        context.globalAlpha = reducedMotion ? 0.42 : 0.32 + Math.sin(t * 1.7) * 0.1;
        context.fillStyle = signals.testing; context.fillRect(439, 48, 21, 15);
      } else if (station === "permission_gate") {
        context.globalAlpha = 0.7; context.fillStyle = signals.needs_input;
        context.fillRect(165.5, 196.3, 6.5, 2.2);
      } else if (station === "shipping_dock") {
        const recent = workers.some((record) => timeline.get(record.key, elapsed).age < 3000);
        if (recent) {
          context.globalAlpha = reducedMotion ? 0.55 : 0.45 + Math.sin(t * 2) * 0.12;
          context.strokeStyle = signals.finished; context.beginPath();
          context.moveTo(401, 210); context.lineTo(404, 213); context.lineTo(410, 206); context.stroke();
        }
      }
      context.globalAlpha = 1;
    }
    context.restore();
  }
}

// Calm, local water movement only. Never a screen-wide weather overlay.
export function drawCreek(context, view, elapsed, reducedMotion) {
  const seconds = reducedMotion ? 0 : elapsed / 1000;
  context.save(); context.strokeStyle = withAlpha(environment.creek_light, 0.48);
  context.lineWidth = Math.max(0.5, view.scale * 0.35);
  for (const [px, py, offset] of [[394, 265, 0], [471, 274, 2], [366, 270, 4], [12, 79, 1]]) {
    const phase = (seconds / 8 + offset / 5) % 1;
    context.globalAlpha = reducedMotion ? 0.5 : Math.sin(phase * Math.PI) * 0.5;
    context.beginPath(); context.ellipse(view.x + px * view.scale, view.y + py * view.scale, (2 + phase * 3) * view.scale, (0.4 + phase) * view.scale, 0, 0, Math.PI * 2); context.stroke();
  }
  // The waterfall is already painted. Narrow highlights travel only inside
  // its white-blue ribbon; moving the painted water itself would leave a copy
  // behind on the flattened plate. Their fixed offsets avoid a synchronized loop.
  context.fillStyle = environment.bloom;
  for (const [px, offset] of [[10.8, 0.18], [13.3, 0.51], [15.2, 0.79]]) {
    const phase = (seconds / ambient.waterfallCycleSeconds + offset) % 1;
    context.globalAlpha = Math.sin(phase * Math.PI) * ambient.waterfallGlintAlpha;
    context.fillRect(view.x + px * view.scale, view.y + (40 + phase * 30) * view.scale,
      0.45 * view.scale, 3.4 * view.scale);
  }
  // Two slow, short flashes in the open dock water complement the existing
  // rings without adding a bright line across the whole shoreline.
  for (const [px, py, offset] of [[357, 270, 0.24], [485, 271, 0.67]]) {
    const phase = (seconds / 9 + offset) % 1;
    context.globalAlpha = Math.sin(phase * Math.PI) * 0.24;
    context.fillRect(view.x + (px + phase * 3) * view.scale, view.y + py * view.scale,
      3.2 * view.scale, 0.35 * view.scale);
  }
  context.restore();
}

export function drawParcel(context, cx, baseY, scale) {
  context.save(); context.translate(cx - 3 * scale, baseY - 11 * scale); context.scale(scale, scale);
  context.fillStyle = environment.cedar; context.strokeStyle = environment.soot; context.lineWidth = 0.6;
  context.fillRect(0, 0, 8, 6); context.strokeRect(0, 0, 8, 6);
  context.strokeStyle = environment.bloom; context.beginPath(); context.moveTo(4, 0); context.lineTo(4, 6); context.moveTo(0, 2); context.lineTo(8, 2); context.stroke();
  context.restore();
}

/* Things in the world that answer a poke. Neither is a session and neither
   says anything; they are there because a place you keep open all day should
   notice when you touch it. Measured against assets/map/workshop-plate-v3.png. */
export const BOAT = Object.freeze({
  x: 439, y: 254,
  /* The hull, hugging the gunwale, with a unit of water around it so the bob
     has something to move over. The dock post at its bow is left out. */
  polygon: Object.freeze([[425, 247.5], [455.5, 244.5], [457, 250], [456.5, 262], [446, 264.5], [433, 264.5], [424.5, 260], [420.5, 251.5]])
});
const FIRE_REACH = Object.freeze({ x: FIRE.x, y: FIRE.y + 3, rx: 17, ry: 16 });

// Which landmark, if any, is under a point in world units.
export function landmarkAt(point) {
  if (!point) return null;
  const dx = (point.x - FIRE_REACH.x) / FIRE_REACH.rx, dy = (point.y - FIRE_REACH.y) / FIRE_REACH.ry;
  if (dx * dx + dy * dy <= 1) return "fire";
  if (insidePolygon(point, BOAT.polygon)) return "boat";
  return null;
}

function insidePolygon({ x, y }, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const BOAT_BOB_MS = 2600;

/* The boat, knocked: it dips, rocks and settles, and the water rings out from
   under it. The hull is the plate's own pixels, clipped and moved; nothing new
   is painted. Reduced motion gets the rings held still and no rocking. */
export function drawBoat(context, plate, view, age, reducedMotion) {
  if (!(age >= 0 && age < BOAT_BOB_MS)) return;
  const { scale, x, y } = view;
  const settle = 1 - age / BOAT_BOB_MS;
  const t = reducedMotion ? 0 : age;
  const dip = Math.sin(t / 170) * 0.9 * settle ** 1.5;
  const rock = Math.sin(t / 230 + 0.8) * 0.018 * settle ** 1.5;
  // Rings first: they spread out from under the boat, not across it.
  context.save();
  context.strokeStyle = withAlpha(environment.creek_light, 0.9);
  context.lineWidth = Math.max(0.6, scale * 0.4);
  for (const delay of [0, 0.22]) {
    const ring = reducedMotion ? 0.35 : (age / BOAT_BOB_MS - delay) / (1 - delay);
    if (ring <= 0 || ring >= 1) continue;
    context.globalAlpha = (1 - ring) * 0.8;
    context.beginPath();
    context.ellipse(x + BOAT.x * scale, y + (BOAT.y + 9) * scale, (20 + ring * 14) * scale, (4 + ring * 4) * scale, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
  // The hull goes over its own rings; held still, it simply covers them.
  context.save(); context.beginPath();
  BOAT.polygon.forEach(([px, py], index) => context[index ? "lineTo" : "moveTo"](x + px * scale, y + py * scale));
  context.closePath(); context.clip();
  context.translate(x + BOAT.x * scale, y + (BOAT.y + dip) * scale);
  context.rotate(rock);
  context.translate(-(x + BOAT.x * scale), -(y + BOAT.y * scale));
  context.drawImage(plate, x, y, 512 * scale, 288 * scale);
  context.restore();
}

/* The scuff of a tapping foot: two specks of dust kicked out either side. */
export function drawTapDust(context, cx, baseY, scale) {
  context.save();
  context.fillStyle = withAlpha(environment.sand_light, 0.85);
  for (const side of [-1, 1]) context.fillRect(cx + side * 6 * scale - 0.5 * scale, baseY - 0.6 * scale, scale, scale * 0.8);
  context.restore();
}
