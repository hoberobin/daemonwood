import { destinationByState, nodes } from "./world-model.js";
import { IDLE_AFTER_MS } from "./state-machine.js";
import { STATION_CLIPS, STATION_FRAME_BASE, stablePhase } from "./art-animation.js";
import { temperament } from "./familiars.js";
import { campfireCompany, impatience, impatiencePose, stateSince } from "./familiar-moods.js";

/* Behaviours: how a familiar carries itself, as a table instead of a chain of
   special cases in the renderer.

   Each entry says which states it belongs to, when it applies, and what pose
   it asks for. One resolver reads the table once a frame and hands the
   renderer one pose per familiar. Adding personality means adding a row here;
   the renderer does not change, and tests/familiar-behaviour.test.js holds
   every row to the same rules:

   - Presentation only. A behaviour never changes state, route or badge, and
     never touches the record it is handed.
   - Only what the map can see: the state, how long it has lasted, how long the
     session has been quiet, and who is standing nearby. Nothing may claim to
     know what the agent is thinking.
   - Deterministic. The wall clock for thresholds, the page clock for cadence,
     the familiar's stable phase to keep neighbours out of step. No randomness.
   - A flourish is a movement, so reduced motion turns every flourish off. A
     held posture — a turned back — stays.
   - A flourish is brief and rare (see FLOURISH_BUDGET), so a map kept open all
     day stays quiet at a glance.
   - Some poses are reserved. The turned back and the raised "?" belong to
     NEEDS INPUT alone, so no other state can be mistaken for asking. */

/* Poses by name, not frame number. Every name resolves to a frame on the
   shared 24-frame sheet today; a familiar whose sheet one day gains a real
   frame for a pose lists it in FAMILIAR_POSES, and only that familiar changes.
   Anything not listed falls back to the shared frame, so a half-finished
   family still draws correctly. */
const station = (state, index) => STATION_FRAME_BASE + STATION_CLIPS[state][index];
export const POSES = Object.freeze({
  face_left: 5,   // first step of the walk left: standing side-on
  face_right: 9,  // first step of the walk right
  back: 13,       // first step of the walk away: back turned
  asking: 18,     // the parchment "?" held up
  /* Station work, from the optional station sheet. These resolve only for a
     familiar whose sheet has loaded; for anyone else they resolve to nothing
     and the familiar draws exactly as it did before the sheet existed. */
  hammer_up: station("editing", 0),
  hammer_down: station("editing", 1),
  book_read: station("investigating", 0),
  book_turn: station("investigating", 1),
  lever_ready: station("running", 0),
  lever_pull: station("running", 1),
  flask_hold: station("testing", 0),
  flask_swirl: station("testing", 1)
});
export const RESERVED_POSES = Object.freeze({
  back: "needs_input", asking: "needs_input",
  hammer_up: "editing", hammer_down: "editing",
  book_read: "investigating", book_turn: "investigating",
  lever_ready: "running", lever_pull: "running",
  flask_hold: "testing", flask_swirl: "testing"
});
export const FAMILIAR_POSES = Object.freeze({});

/* `stationSheets` is whatever can answer `.has(type)` for the familiars
   whose station sheet is actually loaded — the renderer's own map of images.
   A station pose for anyone else is no pose at all. */
export function poseFrame(name, familiarType, stationSheets = null) {
  if (!name) return null;
  const frame = FAMILIAR_POSES[familiarType]?.[name] ?? POSES[name];
  if (frame === undefined) return null;
  if (frame >= STATION_FRAME_BASE && !stationSheets?.has(familiarType)) return null;
  return frame;
}

// No flourish may be active more than this share of the time, nor come round
// more often than this. Checked for every flourish at the quickest tempo.
export const FLOURISH_BUDGET = Object.freeze({ maxShare: 0.15, minEveryMs: 6000 });

const WORK_STATES = Object.freeze(["preparing", "investigating", "editing", "running", "testing"]);

/* A brief movement that comes round on a cadence. Its window is spread across
   the whole cycle by the familiar's phase, and stretched by its tempo: a brisk
   familiar does its thing a little more often than a calm one. */
export function flourishActive(ctx, { everyMs, lastsMs }) {
  const every = everyMs * ctx.tempo;
  const offset = (ctx.phase * 7919) % every;
  return (ctx.elapsed + offset) % every < lastsMs;
}

function facingToward(fromX, toX) {
  if (fromX === toX) return null;
  return toX > fromX ? "face_right" : "face_left";
}

// A little hop, height in world units, over `lastsMs` from the window's start.
function hop(ctx, { everyMs, lastsMs }, height) {
  const every = everyMs * ctx.tempo;
  const into = (ctx.elapsed + (ctx.phase * 7919) % every) % every;
  return into < lastsMs ? Math.sin((into / lastsMs) * Math.PI) * height : 0;
}

const ASKING_FRAMES = new Map(Object.entries(POSES).map(([name, frame]) => [frame, name]));

export const BEHAVIOURS = Object.freeze([
  Object.freeze({
    id: "needs_input.impatience",
    summary: "Kept waiting, a familiar hops, then taps its foot, then turns its back and looks round with its sign up.",
    states: ["needs_input"],
    priority: 50,
    pose(ctx) {
      const level = impatience(ctx.record, ctx.now).level;
      const pose = impatiencePose(level, ctx.elapsed, { phase: ctx.phase, reducedMotion: ctx.reducedMotion });
      return { pose: pose.frame === null ? undefined : ASKING_FRAMES.get(pose.frame), lift: pose.lift, tap: pose.tap };
    }
  }),
  Object.freeze({
    id: "idle.company",
    summary: "Two or more resting at the fire turn to face it, and each other.",
    states: ["idle"],
    priority: 40,
    pose(ctx) {
      const company = ctx.company.get(ctx.record.key);
      return company ? { pose: company.facing === "right" ? "face_right" : "face_left" } : null;
    }
  }),
  Object.freeze({
    id: "idle.firewatch",
    summary: "At the campfire a resting familiar briefly turns toward the flames and takes a small, slow breath.",
    states: ["idle"],
    priority: 30,
    flourish: { everyMs: 9000, lastsMs: 900 },
    pose(ctx) {
      if (!ctx.atOwnStation || !flourishActive(ctx, this.flourish)) return null;
      const pose = facingToward(ctx.agent.position.x, nodes.campfire.x);
      const every = this.flourish.everyMs * ctx.tempo;
      const into = (ctx.elapsed + (ctx.phase * 7919) % every) % every;
      return { pose: pose ?? undefined, lift: Math.sin((into / this.flourish.lastsMs) * Math.PI) * 0.8 };
    }
  }),
  Object.freeze({
    id: "arriving.look_around",
    summary: "A familiar that has just arrived looks one way, then the other, taking the place in.",
    states: ["arriving"],
    priority: 30,
    flourish: { everyMs: Infinity, lastsMs: 2800, oneShot: true },
    pose(ctx) {
      const age = ctx.stateAge;
      if (age === null) return null;
      if (age >= 600 && age < 1500) return { pose: "face_left" };
      if (age >= 1900 && age < 2800) return { pose: "face_right" };
      return null;
    }
  }),
  Object.freeze({
    id: "work.station_item",
    summary: "At its own station a familiar works with that station's tool: a mallet, a book, a lever or a flask, in a short beat and a rest.",
    states: ["editing", "investigating", "running", "testing"],
    // Above the stationmates' glance: the side-on frames hold no tool, and a
    // tool that blinks out of a familiar's paws for a glance reads as a glitch.
    priority: 25,
    beats: Object.freeze({
      editing: Object.freeze({ hold: "hammer_up", strike: "hammer_down", everyMs: 4200, strikes: 3, strikeMs: 360 }),
      investigating: Object.freeze({ hold: "book_read", strike: "book_turn", everyMs: 6000, strikes: 1, strikeMs: 700 }),
      running: Object.freeze({ hold: "lever_ready", strike: "lever_pull", everyMs: 5000, strikes: 1, strikeMs: 650 }),
      testing: Object.freeze({ hold: "flask_hold", strike: "flask_swirl", everyMs: 4500, strikes: 1, strikeMs: 700 })
    }),
    pose(ctx) {
      const beat = this.beats[ctx.state];
      if (!beat || !ctx.atOwnStation || !ctx.poseAvailable(beat.hold) || !ctx.poseAvailable(beat.strike)) return null;
      // Reduced motion holds the tool still: a posture, not a movement.
      if (ctx.reducedMotion) return { pose: beat.hold };
      const every = beat.everyMs * ctx.tempo;
      const into = (ctx.elapsed + (ctx.phase * 7919) % every) % every;
      // Each strike is the lowered frame for the first half of its slot.
      const striking = into < beat.strikes * beat.strikeMs && into % beat.strikeMs < beat.strikeMs / 2;
      return { pose: striking ? beat.strike : beat.hold };
    }
  }),
  Object.freeze({
    id: "work.stationmates",
    summary: "Working beside someone at the same station, a familiar glances over at them now and then.",
    states: WORK_STATES,
    priority: 20,
    flourish: { everyMs: 13_000, lastsMs: 1100 },
    pose(ctx) {
      const mate = ctx.nearestMate;
      if (!mate || !flourishActive(ctx, this.flourish)) return null;
      const pose = facingToward(ctx.agent.position.x, mate.controller.position.x);
      return pose ? { pose } : null;
    }
  }),
  Object.freeze({
    id: "finished.homeward",
    summary: "In the last minute before a quiet DONE drifts to IDLE, a familiar glances toward the fire.",
    states: ["finished"],
    priority: 20,
    flourish: { everyMs: 12_000, lastsMs: 1300 },
    pose(ctx) {
      if (ctx.quietFor === null || ctx.quietFor < IDLE_AFTER_MS - 60_000 || ctx.quietFor >= IDLE_AFTER_MS) return null;
      if (!flourishActive(ctx, this.flourish)) return null;
      const pose = facingToward(ctx.agent.position.x, nodes.campfire.x);
      return pose ? { pose } : null;
    }
  }),
  Object.freeze({
    id: "trouble.fretting",
    summary: "Trouble left sitting for two minutes gets a small, anxious hop now and then.",
    states: ["trouble"],
    priority: 20,
    flourish: { everyMs: 8000, lastsMs: 320 },
    pose(ctx) {
      if (ctx.stateAge === null || ctx.stateAge < 2 * 60_000) return null;
      const lift = hop(ctx, this.flourish, 1.6);
      return lift > 0 ? { lift } : null;
    }
  })
]);

export const EMPTY_POSE = Object.freeze({ frame: null, lift: 0, tap: false, behaviours: Object.freeze([]) });

function settled(record) {
  const agent = record.controller;
  return !agent.moving && !agent.leaving && agent.currentNode === agent.destination;
}

function timeSince(value, now) {
  const at = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

/* Everything a behaviour may read about one familiar, and nothing more. */
function contextFor(record, { now, elapsed, reducedMotion, company, byStation, stationSheets }) {
  const agent = record.controller;
  const since = stateSince(record);
  const mates = (byStation.get(agent.currentNode) ?? []).filter((other) => other.key !== record.key);
  const nearestMate = mates.reduce((best, other) => {
    const distance = Math.abs(other.controller.position.x - agent.position.x);
    return !best || distance < best.distance ? { record: other, distance } : best;
  }, null)?.record ?? null;
  return {
    record, agent, now, elapsed, reducedMotion, company, nearestMate,
    state: agent.state,
    atOwnStation: agent.currentNode === destinationByState[agent.state],
    poseAvailable: (name) => poseFrame(name, record.familiarType, stationSheets) !== null,
    phase: stablePhase(record.key),
    tempo: temperament(record.familiarType).tempo,
    stateAge: since === null ? null : Math.max(0, now - since),
    quietFor: timeSince(record.lastEventAt, now)
  };
}

/* One pose per familiar, this frame. Behaviours are tried highest priority
   first; each channel — the body (which frame) and the motion (lift and the
   tap of a foot) — goes to the first behaviour that sets it. Only a familiar
   standing still has a pose: walking is walking, and leaving is leaving. */
export function resolvePoses(records, { now = Date.now(), elapsed = 0, reducedMotion = false, stationSheets = null } = {}) {
  const company = campfireCompany(records);
  const byStation = new Map();
  for (const record of records) {
    if (!settled(record)) continue;
    const node = record.controller.currentNode;
    if (!byStation.has(node)) byStation.set(node, []);
    byStation.get(node).push(record);
  }
  const shared = { now, elapsed, reducedMotion, company, byStation, stationSheets };
  const poses = new Map();
  for (const record of records) {
    const agent = record.controller;
    if (agent.moving || agent.leaving) { poses.set(record.key, EMPTY_POSE); continue; }
    const ctx = contextFor(record, shared);
    let body, lift, tap;
    const used = [];
    for (const behaviour of ORDERED) {
      if (!behaviour.states.includes(ctx.state)) continue;
      if (behaviour.flourish && reducedMotion) continue;
      const result = behaviour.pose(ctx);
      if (!result) continue;
      let took = false;
      if (body === undefined && result.pose !== undefined) { body = result.pose; took = true; }
      if (lift === undefined && (result.lift || result.tap)) { lift = result.lift || 0; tap = Boolean(result.tap); took = true; }
      if (took) used.push(behaviour.id);
    }
    poses.set(record.key, Object.freeze({
      frame: poseFrame(body, record.familiarType, stationSheets),
      lift: reducedMotion ? 0 : lift ?? 0,
      tap: reducedMotion ? false : tap ?? false,
      behaviours: Object.freeze(used)
    }));
  }
  return poses;
}

const ORDERED = Object.freeze([...BEHAVIOURS].sort((a, b) => b.priority - a.priority));
