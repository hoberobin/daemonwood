// Animation is presentation only. It never changes a session's state or route.
export const SPRITE = Object.freeze({ size: 128, columns: 4, rows: 6, drawSize: 42, pivotX: 64, pivotY: 119 });
export const CLIPS = Object.freeze({
  "walk:down": [0, 1, 2, 3], "walk:left": [4, 5, 6, 7],
  "walk:right": [8, 9, 10, 11], "walk:up": [12, 13, 14, 15],
  idle: [16, 17], needs_input: [18, 19], trouble: [20, 21], finished: [22, 23]
});
/* The optional station-work sheet (art/source/station-contract.json): two
   frames per working state, on a 4x2 sheet of its own beside the base sheet.
   The behaviour engine numbers these frames from STATION_FRAME_BASE up, so a
   pose can name one without a second kind of frame; the renderer reads any
   frame at or past the base from the station sheet. */
export const STATION_CLIPS = Object.freeze({
  editing: [0, 1], investigating: [2, 3], running: [4, 5], testing: [6, 7]
});
export const STATION_FRAME_BASE = 24;
export function stablePhase(key = "") {
  let value = 0;
  for (const letter of String(key)) value = (value * 31 + letter.charCodeAt(0)) >>> 0;
  return value % 7300;
}
export function animationFrame(agent, elapsed, { reducedMotion = false, phase = 0, stateAge = 0 } = {}) {
  const time = reducedMotion ? 0 : elapsed + phase;
  let clip = "idle", index = 0;
  if (agent.moving || agent.leaving) {
    clip = `walk:${agent.direction || "down"}`;
    index = reducedMotion ? 0 : Math.floor(time / 145) % 4;
  } else if (agent.state === "needs_input" || agent.state === "trouble") {
    clip = agent.state;
    index = time % 4200 > 3550 ? 1 : 0;
  } else if (agent.state === "finished") {
    clip = "finished";
    // The acknowledgement lasts at most three seconds, then rests with parcel.
    index = !reducedMotion && stateAge < 3000 ? Math.floor(time / 600) % 2 : 0;
  } else {
    // Brief, infrequent blink rather than a perpetual two-frame twitch.
    index = time % 7300 > 7100 ? 1 : 0;
  }
  return { clip, ...frameRect((CLIPS[clip] || CLIPS.idle)[index]) };
}

// Where one frame of the shared 24-frame sheet sits, in source pixels.
export function frameRect(frame) {
  return { frame, x: frame % SPRITE.columns * SPRITE.size, y: Math.floor(frame / SPRITE.columns) * SPRITE.size };
}
export function helperCount(count) {
  const value = Number(count);
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return { visible: Math.min(3, total), overflow: Math.max(0, total - 3) };
}

// Retained per renderer, keyed by session. Repeated tool events in the same
// state do not restart the acknowledgement. Removed records are pruned.
export class ArtTimeline {
  constructor() { this.records = new Map(); }
  update(records, elapsed) {
    const live = new Set(records.map((record) => record.key));
    for (const key of this.records.keys()) if (!live.has(key)) this.records.delete(key);
    for (const record of records) {
      let item = this.records.get(record.key);
      if (!item) {
        item = { state: record.controller.state, since: elapsed, helpers: helperCount(record.subagents).visible, helpersSince: elapsed, previousHelpers: 0 };
        this.records.set(record.key, item);
      }
      if (item.state !== record.controller.state) { item.state = record.controller.state; item.since = elapsed; }
      const next = helperCount(record.subagents).visible;
      if (item.helpers !== next) { item.previousHelpers = item.helpers; item.helpers = next; item.helpersSince = elapsed; }
    }
  }
  get(key, elapsed) {
    const item = this.records.get(key);
    return item ? { ...item, age: Math.max(0, elapsed - item.since), helperAge: Math.max(0, elapsed - item.helpersSince) } : { age: 0, helperAge: 0, helpers: 0, previousHelpers: 0 };
  }
}
