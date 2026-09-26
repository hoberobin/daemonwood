import { nodes } from "./world-model.js";

/* Moods: how a familiar carries itself while nothing about its session changes.

   Presentation only, like the rest of the animation. A mood never moves a
   familiar, never changes its state, and never adds a sign over its head — the
   one glyph up there stays the one fact. What a mood changes is posture, and
   every posture is read off the wall clock, so a reload lands a familiar in the
   same mood it was in rather than starting it over. */

/* Frames on the shared 24-frame sheet (see familiar-atlas-v1.json). No mood
   needs art of its own: a back turned is the first step of the walk away, and a
   familiar facing the fire is the first step of a walk toward it. */
const FRAME = Object.freeze({ back: 13, faceLeft: 5, faceRight: 9, asking: 18 });

/* How long a session has been waiting on you, and what that does to the one
   waiting. Each step is a stronger version of the same request, and none of
   them hides it: the badge, the gold ring and the "?" sign all stay, except
   while the sulking familiar has its back turned — and it turns round to show
   the sign again every few seconds. */
export const IMPATIENCE = Object.freeze([
  Object.freeze({ level: 0, name: "calm", after: 0 }),
  Object.freeze({ level: 1, name: "glancing", after: 60_000 }),
  Object.freeze({ level: 2, name: "tapping", after: 5 * 60_000 }),
  Object.freeze({ level: 3, name: "sulking", after: 15 * 60_000 })
]);

/* When the current state began. The registry stamps `stateSince` on every
   change; the trail is the fallback for a record built by hand. */
export function stateSince(record) {
  const stamped = Number(record?.stateSince);
  if (Number.isFinite(stamped) && stamped > 0) return stamped;
  const trailed = Date.parse(record?.trail?.[0]?.at || record?.lastEventAt || "");
  return Number.isFinite(trailed) ? trailed : null;
}

// How long this session has been asking. Zero for anyone not asking.
export function waitedMs(record, now = Date.now()) {
  if (record?.controller?.state !== "needs_input" || record.controller.leaving) return 0;
  const since = stateSince(record);
  return since === null ? 0 : Math.max(0, now - since);
}

export function impatience(record, now = Date.now()) {
  const waited = waitedMs(record, now);
  const step = waited ? IMPATIENCE.findLast((candidate) => waited >= candidate.after) : IMPATIENCE[0];
  return { ...step, waited };
}

/* "7m", "1h 5m". Empty under a minute: a fresh request does not need a clock
   on it, and a clock that reads "0m" looks like a bug. */
export function waitLabel(ms) {
  const minutes = Math.floor((Number(ms) || 0) / 60_000);
  if (minutes < 1) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/* What an impatient familiar looks like right now. `frame` replaces the sheet
   frame when set; `lift` raises the body in world units (a hop or a tap);
   `tap` marks the instant a foot comes down, for the scuff of dust.

   Reduced motion keeps the postures — a turned back is a pose, not a movement
   — and drops the hops, the taps and the glances over the shoulder. */
export function impatiencePose(level, elapsed, { phase = 0, reducedMotion = false } = {}) {
  const pose = { frame: null, lift: 0, tap: false };
  if (level >= 3) {
    pose.frame = FRAME.back;
    if (reducedMotion) return pose;
    // Every six seconds it looks round, sign up, to see if you have come.
    if ((elapsed + phase) % 6000 > 5100) pose.frame = FRAME.asking;
    return pose;
  }
  if (reducedMotion || level < 1) return pose;
  if (level === 2) {
    // Tap, tap, tap — pause. Three quick dips every 1.8 seconds.
    const beat = (elapsed + phase) % 1800;
    if (beat < 720) {
      const within = beat % 240;
      pose.lift = within < 120 ? Math.sin((within / 120) * Math.PI) * 1.1 : 0;
      pose.tap = within >= 110 && within < 170;
    }
    return pose;
  }
  // A little hop every five seconds: "still here".
  const beat = (elapsed + phase) % 5000;
  if (beat < 320) pose.lift = Math.sin((beat / 320) * Math.PI) * 2.2;
  return pose;
}

/* Campfire company. Resting alone, a familiar just rests. Two or more resting
   at the fire together turn to face it — and each other — and after a minute of
   one another's company. */

function settledAtFire(record) {
  const agent = record.controller;
  return agent.state === "idle" && !agent.moving && !agent.leaving &&
    agent.currentNode === "campfire" && agent.destination === "campfire";
}

/* Who is keeping whom company, keyed by session. Each familiar's company began
   when it AND at least one other were resting — so a third joining the circle
   does not restart the first two's company. */
export function campfireCompany(records) {
  const present = records.filter(settledAtFire);
  const company = new Map();
  if (present.length < 2) return company;
  const starts = present.map((record) => stateSince(record) ?? 0).sort((a, b) => a - b);
  for (const record of present) {
    company.set(record.key, {
      facing: record.controller.position.x < nodes.campfire.x ? "right" : "left",
      since: Math.max(stateSince(record) ?? 0, starts[1])
    });
  }
  return company;
}

export function companyFrame(facing) {
  return facing === "right" ? FRAME.faceRight : FRAME.faceLeft;
}
