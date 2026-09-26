import { AgentController, MAP_FAMILIAR_LIMIT } from "./world-model.js";
import { IDLE_AFTER_MS, restingStateFor, VISUAL_STATES } from "./state-machine.js";
import { chooseFamiliar, familiarByType, isGenericAgentName } from "./familiars.js";

// Kept as a public re-export for existing integrations that imported the
// family from the registry before the catalog became its own module.
export { FAMILIARS } from "./familiars.js";

/* Which sessions earn one of the places on the map when more are connected than
   it draws. Waiting sessions take priority, but more can wait at once than fit.
   The session picker keeps every session reachable beyond the drawing limit. Resting
   sessions yield first, because nothing is happening to them. */
const visibilityRank = Object.freeze({
  [VISUAL_STATES.NEEDS_INPUT]: 0,
  [VISUAL_STATES.TROUBLE]: 1,
  [VISUAL_STATES.FINISHED]: 3,
  [VISUAL_STATES.IDLE]: 4
});

/* Which ends of a session get a walk to the gate. A session that said goodbye,
   or whose process is gone, is a familiar leaving. A session `/clear` handed
   over is not: the newcomer wears the same face at the same terminal, and a
   goodbye beside a hello would be two of the same creature. `unproven` and
   `reset` are the bridge taking back something that should not have been
   drawn, and there is nothing to wave to. */
const farewellReasons = new Set(["session_ended", "disconnected"]);

/* The longest a farewell is allowed to take, from the turn to the gate,
   whatever the path. A familiar the walk has somehow failed to remove is
   removed by the clock. */
export const FAREWELL_MAX_MS = 8_000;

export class AgentRegistry {
  /* `maxVisible` is a drawing limit, not a listening limit. Every connected
     session is kept and counted; the map shows the ones that matter most and
     the interface says plainly how many it is not showing. `maxRecords` is a
     safety valve against an adapter that invents session IDs forever. */
  constructor({ maxVisible = MAP_FAMILIAR_LIMIT, maxRecords = 64 } = {}) {
    this.maxVisible = maxVisible;
    this.maxRecords = maxRecords;
    this.records = new Map();
    /* Familiars on their way out. They are drawn, and a selection can follow
       them to the gate, but they are not sessions any more: not counted, not
       seated, not listed, and not in anyone's way. */
    this.departing = new Map();
    this.selectedId = null;
    this.visibleKeys = [];
  }

  apply(event) {
    if (!event?.sessionId) return null;
    const key = event.sessionId;
    if (event.removesSession) {
      const removed = this.records.get(key);
      if (!removed) return null;
      if (isOlder(event.timestamp, removed.lastEventAt)) return null;
      const wasDrawn = this.visibleKeys.includes(key);
      this.records.delete(key);
      /* A familiar that was on the map walks off it; one that was never
         drawn was never there to leave. The selection follows it to the
         gate — closing the panel the instant a session ends would make the
         goodbye the one thing you could not read about. */
      if (wasDrawn && farewellReasons.has(event.type)) {
        removed.leaving = { at: Date.parse(event.timestamp) || Date.now(), reason: event.type };
        removed.controller.leave();
        this.departing.set(key, removed);
      } else if (this.selectedId === key) {
        this.selectedId = null;
      }
      this.refreshVisibility();
      return { ...removed, removed: true };
    }
    // Back from the gate: a session the bridge re-admitted is a session again.
    this.departing.delete(key);
    let record = this.records.get(key);
    if (!record) {
      this.enforceRecordCeiling();
      /* The bridge names the familiar at admission, so the sprite here matches
         the name a terminal's status line shows. Choosing locally is only the
         fallback for an event that arrives without one. */
      const familiar = familiarByType(event.familiarType) ||
        chooseFamiliar(key, this.visible.map((other) => other.familiarType));
      record = {
        key,
        sessionId: event.sessionId,
        familiarType: familiar.type,
        familiarSpecies: familiar.species,
        agentName: familiarName(event.agentName, familiar.name),
        repository: event.repository || "unlabeled-repo",
        taskLabel: event.taskLabel || "Unlabeled task",
        sessionName: event.sessionName || null,
        sessionNameSource: event.sessionNameSource || null,
        terminalProgram: event.terminalProgram || null,
        terminalTty: event.terminalTty || null,
        subagents: 0,
        controller: new AgentController({ start: "workbench", occupancySlot: 0, speed: 82 }),
        trail: [],
        lastEventAt: event.timestamp,
        /* When the current state began, on the wall clock. Moods read it —
           how long a session has waited on you, how long two have sat at the
           fire — so it comes from event time, not page time, and a reload
           lands every familiar in the mood it left. */
        stateSince: timeOf(event.timestamp)
      };
      this.records.set(key, record);
    }
    if (isOlder(event.timestamp, record.lastEventAt)) return record;
    if (event.agentName && !isGenericAgentName(event.agentName)) record.agentName = event.agentName;
    if (event.repository && event.repository !== "unlabeled-repo") record.repository = event.repository;
    if (event.taskLabel && event.taskLabel !== "Unlabeled task") record.taskLabel = event.taskLabel;
    if (event.sessionName) {
      record.sessionName = event.sessionName;
      record.sessionNameSource = event.sessionNameSource || null;
    }
    if (event.terminalProgram) record.terminalProgram = event.terminalProgram;
    if (event.terminalTty) record.terminalTty = event.terminalTty;
    record.lastEventAt = event.timestamp || record.lastEventAt;
    if (Number.isInteger(event.subagentCount)) record.subagents = Math.max(0, event.subagentCount);
    else if (event.subagentDelta) record.subagents = Math.max(0, record.subagents + event.subagentDelta);
    /* A short trail of where this familiar has been. It answers "what has this
       session been doing?" without a global log of everything at once. */
    if (event.visualState && event.visualState !== record.controller.state) {
      record.trail.unshift({ at: record.lastEventAt, state: event.visualState });
      record.trail.splice(6);
      record.stateSince = timeOf(record.lastEventAt);
    }
    if (event.visualState) record.controller.setState(event.visualState);
    this.refreshVisibility();
    return record;
  }

  /* Recompute which sessions stand on the map, then where each of them stands.
     Both are derived from the current records every time rather than remembered,
     so there is no seating state to drift out of step with what is connected. */
  refreshVisibility() {
    const ordered = [...this.records.values()].sort(compareForVisibility);
    const next = ordered.slice(0, this.maxVisible);
    const nextKeys = next.map((record) => record.key);
    const changed = nextKeys.length !== this.visibleKeys.length ||
      nextKeys.some((key, index) => key !== this.visibleKeys[index]);
    this.visibleKeys = nextKeys;

    this.placeVisible(next);

    // Inspection is independent of the drawing places. Losing a map
    // place must never close the session the user is reading.
    if (this.selectedId && !this.records.has(this.selectedId) && !this.departing.has(this.selectedId)) this.selectedId = null;
    return changed;
  }

  /* Spots are handed out per station, not globally. A familiar alone at the
     Shipping Dock must stand on the dock; only familiars that genuinely share a
     station get staggered, and they re-centre as soon as the others leave. */
  placeVisible(visible = this.visible) {
    const byStation = new Map();
    for (const record of visible) {
      const station = record.controller.destination;
      if (!byStation.has(station)) byStation.set(station, []);
      byStation.get(station).push(record);
    }
    let moved = false;
    for (const group of byStation.values()) {
      // Stable order, so who stands where does not shuffle between frames.
      group.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
      group.forEach((record, index) => {
        if (record.controller.setPlacement(index, group.length)) moved = true;
      });
    }
    return moved;
  }

  forget(key) {
    this.records.delete(key);
    this.departing.delete(key);
    if (this.selectedId === key) this.selectedId = null;
  }

  /* Only reached if something upstream is manufacturing sessions. Drop the
     quietest resting session rather than refuse to hear about a new one. */
  enforceRecordCeiling() {
    while (this.records.size >= this.maxRecords) {
      const quietest = [...this.records.values()].sort(compareForVisibility).at(-1);
      if (!quietest) return;
      this.forget(quietest.key);
    }
  }

  /* Nothing is broadcast when a session simply stops being interesting, so the
     walk from the Shipping Dock to the campfire has to be driven by the clock.
     Deriving it from `lastEventAt` rather than counting down means a reload or
     an SSE reconnect lands the familiar in the same place it was standing. */
  settle(now = Date.now()) {
    let changed = false;
    for (const record of this.records.values()) {
      const current = record.controller.state;
      const rested = restingStateFor(current, record.lastEventAt, now);
      if (rested === current) continue;
      record.trail.unshift({ at: new Date(now).toISOString(), state: rested });
      record.trail.splice(6);
      /* It went idle when the quiet ran out, not when this tick noticed —
         otherwise every reload would restart the campfire's company. */
      const quiet = Date.parse(record.lastEventAt || "");
      record.stateSince = Number.isFinite(quiet) ? Math.min(now, quiet + IDLE_AFTER_MS) : now;
      record.controller.setState(rested);
      changed = true;
    }
    // Going quiet can cost a session its place on the map, and always changes
    // which station it stands at, so both follow every settle.
    if (changed) this.refreshVisibility();
    return changed;
  }

  update(deltaSeconds, now = Date.now()) {
    let arrivalChanged = this.settle(now);
    for (const record of this.visible) {
      const wasMoving = record.controller.moving;
      record.controller.update(deltaSeconds);
      if (wasMoving && !record.controller.moving) arrivalChanged = true;
    }
    /* The walk out. Through the gate, or out of time: either way the familiar
       is gone, and whoever was watching it in the panel is let go. */
    for (const [key, record] of this.departing) {
      record.controller.update(deltaSeconds);
      const through = !record.controller.moving || record.controller.departure >= 1;
      if (through || now - record.leaving.at > FAREWELL_MAX_MS) {
        this.departing.delete(key);
        if (this.selectedId === key) this.selectedId = null;
        arrivalChanged = true;
      }
    }
    return arrivalChanged;
  }

  // Hit-testing without side effects, so hovering can use the same geometry as
  // clicking without quietly moving the selection under the pointer. A
  // departing familiar answers to the pointer — "who was that?" — but not to
  // a click: there is nothing left to select.
  findNearest(x, y, radius = 28, { departing = false } = {}) {
    let nearest = null;
    for (const record of departing ? this.drawn : this.visible) {
      const distance = Math.hypot(record.controller.position.x - x, record.controller.position.y - y);
      if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { record, distance };
    }
    return nearest ? nearest.record : null;
  }

  selectNearest(x, y, radius = 28) {
    const record = this.findNearest(x, y, radius);
    if (record) this.selectedId = record.key;
    return record;
  }

  // Step through the familiars in place order, so the arrow keys walk the map
  // left to right rather than in whatever order sessions happened to connect.
  cycle(step) {
    const ordered = [...this.visible.sort((left, right) => left.controller.occupancySlot - right.controller.occupancySlot), ...this.hidden];
    if (!ordered.length) return null;
    const index = ordered.findIndex((record) => record.key === this.selectedId);
    const next = index === -1
      ? (step > 0 ? 0 : ordered.length - 1)
      : (index + step + ordered.length) % ordered.length;
    this.selectedId = ordered[next].key;
    return ordered[next];
  }

  get selected() {
    return this.records.get(this.selectedId) || this.departing.get(this.selectedId) || null;
  }

  get visible() {
    return this.visibleKeys.map((key) => this.records.get(key)).filter(Boolean);
  }

  /* Everyone on the map: the sessions with a place, and the familiars on
     their way out. This is what the renderer draws; everything that counts,
     seats or lists sessions reads `visible` instead. */
  get drawn() {
    return [...this.visible, ...this.departing.values()];
  }

  /* Connected, counted, and not currently drawn. The interface owes the user
     this number: the familiars drawn must never be mistaken for every session. */
  get hidden() {
    const shown = new Set(this.visibleKeys);
    return [...this.records.values()].filter((record) => !shown.has(record.key));
  }

  get summary() {
    const records = [...this.records.values()];
    const states = records.map((record) => record.controller.state);
    return {
      connected: records.length,
      hidden: Math.max(0, records.length - this.visibleKeys.length),
      active: states.filter((state) => ![VISUAL_STATES.FINISHED, VISUAL_STATES.IDLE, VISUAL_STATES.NEEDS_INPUT].includes(state)).length,
      waiting: states.filter((state) => state === VISUAL_STATES.NEEDS_INPUT).length,
      finished: states.filter((state) => state === VISUAL_STATES.FINISHED).length
    };
  }

  clear() {
    this.records.clear();
    this.departing.clear();
    this.visibleKeys = [];
    this.selectedId = null;
  }
}

function compareForVisibility(left, right) {
  const byRank = rankOf(left) - rankOf(right);
  if (byRank !== 0) return byRank;
  return (Date.parse(right.lastEventAt) || 0) - (Date.parse(left.lastEventAt) || 0);
}

function rankOf(record) {
  return visibilityRank[record.controller.state] ?? 2;
}

function familiarName(agentName, fallbackName) {
  return isGenericAgentName(agentName) ? fallbackName : agentName || fallbackName;
}

// An event's timestamp as epoch milliseconds, or now for one that has none.
function timeOf(timestamp) {
  const parsed = Date.parse(timestamp || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isOlder(incoming, current) {
  const incomingTime = Date.parse(incoming || "");
  const currentTime = Date.parse(current || "");
  return Number.isFinite(incomingTime) && Number.isFinite(currentTime) && incomingTime < currentTime;
}
