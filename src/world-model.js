import { VISUAL_STATES } from "./state-machine.js";

export const nodes = Object.freeze({
  workbench: { x: 102, y: 82 },
  research: { x: 226, y: 82 },
  command: { x: 322, y: 82 },
  test_dungeon: { x: 450, y: 90 },
  campfire: { x: 257, y: 151 },
  permission_gate: { x: 103, y: 216 },
  shipping_dock: { x: 408, y: 219 },
  ring_northwest: { x: 165, y: 111 },
  ring_north: { x: 257, y: 105 },
  ring_northeast: { x: 356, y: 111 },
  ring_west: { x: 166, y: 158 },
  ring_east: { x: 348, y: 158 },
  ring_south: { x: 257, y: 205 },
  /* The way out. The plate paints a chained gate between two lanterns at the
     foot of the south path, and it is the one edge of the clearing a path
     actually leaves by. The node sits below the plate so a familiar walking
     to it walks out of the picture rather than stopping at the fence. */
  exit: { x: 257, y: 322 }
});

export const EXIT_NODE = "exit";

/* Every lifecycle gets one place, and familiars sharing it must not stack. The
   spread therefore depends on how many are actually there: alone, a familiar
   stands ON its station, because a lone one standing a third of a station to
   the left reads as "near the dock", not "at the dock" — and at the Shipping
   Dock that offset put it in the river. Only a crowd gets staggered. */
const stationSpread = Object.freeze([
  Object.freeze([{ x: 0, y: 0 }]),
  Object.freeze([{ x: -26, y: 0 }, { x: 26, y: 0 }]),
  Object.freeze([{ x: -34, y: -4 }, { x: 0, y: 4 }, { x: 34, y: -4 }]),
  Object.freeze([{ x: -32, y: -6 }, { x: 32, y: -6 }, { x: -32, y: 30 }, { x: 32, y: 30 }]),
  /* Past four, two rows: the back row fills first so the front row stays
     short, and the widest row (±45) still clears the next station over. */
  Object.freeze([{ x: -34, y: -6 }, { x: 0, y: -6 }, { x: 34, y: -6 }, { x: -17, y: 28 }, { x: 17, y: 28 }]),
  Object.freeze([{ x: -34, y: -6 }, { x: 0, y: -6 }, { x: 34, y: -6 }, { x: -34, y: 28 }, { x: 0, y: 28 }, { x: 34, y: 28 }]),
  Object.freeze([{ x: -45, y: -6 }, { x: -15, y: -6 }, { x: 15, y: -6 }, { x: 45, y: -6 }, { x: -30, y: 28 }, { x: 0, y: 28 }, { x: 30, y: 28 }]),
  Object.freeze([{ x: -45, y: -6 }, { x: -15, y: -6 }, { x: 15, y: -6 }, { x: 45, y: -6 }, { x: -45, y: 28 }, { x: -15, y: 28 }, { x: 15, y: 28 }, { x: 45, y: 28 }])
]);

/* The most familiars the map will draw at once. Every station has a distinct
   spot for each of them; raising it means adding seats here first, or the
   extra familiars stand on top of the first ones. Anyone past it is still
   connected, counted and listed — only not drawn. */
export const MAP_FAMILIAR_LIMIT = stationSpread.length;

const waypointSpread = Object.freeze([
  Object.freeze([{ x: 0, y: 0 }]),
  Object.freeze([{ x: -14, y: 0 }, { x: 14, y: 0 }]),
  Object.freeze([{ x: -16, y: -12 }, { x: 0, y: 8 }, { x: 16, y: -12 }]),
  Object.freeze([{ x: -16, y: -16 }, { x: 16, y: -16 }, { x: -16, y: 16 }, { x: 16, y: 16 }])
]);

// Kept for callers that only need the widest station footprint.
export const stationOffsets = stationSpread.at(-1);

/* Bespoke seating, for a station whose anchor is not open ground. Every other
   station is somewhere you can stand, so centring a lone familiar on the anchor
   is right. The campfire has a bonfire painted at its centre: centred, a
   familiar stood in the flames, and its name tag covered the fire entirely.
   These seats put familiars around the ring the way the art already arranges
   the logs — near side first, so one familiar reads as sitting at the fire. */
const stationSeats = Object.freeze({
  campfire: Object.freeze([
    Object.freeze({ x: -38, y: 20 }),
    Object.freeze({ x: 38, y: 20 }),
    Object.freeze({ x: -54, y: 38 }),
    Object.freeze({ x: 54, y: 38 }),
    Object.freeze({ x: -64, y: 6 }),
    Object.freeze({ x: 64, y: 6 }),
    Object.freeze({ x: -22, y: 50 }),
    Object.freeze({ x: 22, y: 50 })
  ])
});

export const stationPlacards = Object.freeze([
  Object.freeze({ node: "workbench", label: "WORKBENCH", x: 102, y: 19 }),
  Object.freeze({ node: "research", label: "RESEARCH", x: 226, y: 19 }),
  Object.freeze({ node: "command", label: "COMMAND", x: 322, y: 19 }),
  Object.freeze({ node: "test_dungeon", label: "TEST", x: 450, y: 19 }),
  Object.freeze({ node: "campfire", label: "IDLE", x: 257, y: 116 }),
  /* These two sit at the foot of their station rather than over it. A badge
     rides on its familiar's head, and at the two southern stations the head is
     exactly where these placards used to be — so whenever the gate or the dock
     was occupied, its name was the label that got dropped. The name of a place
     matters most when somebody is standing in it. */
  Object.freeze({ node: "permission_gate", label: "NEEDS INPUT", x: 103, y: 240 }),
  Object.freeze({ node: "shipping_dock", label: "DONE", x: 408, y: 243 })
]);

const graph = Object.freeze({
  workbench: ["ring_northwest"],
  research: ["ring_north"],
  command: ["ring_northeast"],
  test_dungeon: ["ring_northeast"],
  campfire: ["ring_north", "ring_west", "ring_east", "ring_south"],
  permission_gate: ["ring_west"],
  shipping_dock: ["ring_east"],
  ring_northwest: ["workbench", "ring_north", "ring_west"],
  ring_north: ["research", "ring_northwest", "ring_northeast", "campfire"],
  ring_northeast: ["command", "test_dungeon", "ring_north", "ring_east"],
  ring_west: ["permission_gate", "campfire", "ring_northwest"],
  ring_east: ["shipping_dock", "campfire", "ring_northeast"],
  ring_south: ["campfire", "exit"],
  exit: ["ring_south"]
});

export const destinationByState = Object.freeze({
  [VISUAL_STATES.ARRIVING]: "workbench",
  [VISUAL_STATES.IDLE]: "campfire",
  [VISUAL_STATES.PREPARING]: "workbench",
  [VISUAL_STATES.INVESTIGATING]: "research",
  [VISUAL_STATES.EDITING]: "workbench",
  [VISUAL_STATES.RUNNING]: "command",
  [VISUAL_STATES.TESTING]: "test_dungeon",
  [VISUAL_STATES.NEEDS_INPUT]: "permission_gate",
  [VISUAL_STATES.TROUBLE]: "command",
  [VISUAL_STATES.FINISHED]: "shipping_dock"
});

/* The last stretch of the walk out, in world units, over which a departing
   familiar fades: from about the gate's lanterns to the node past the plate. */
const FADE_DISTANCE = 70;

export function stationPosition(node, slot = 0, crowd = 1) {
  const position = nodes[node];
  if (!position) return null;
  const seats = stationSeats[node];
  if (seats) {
    const seat = seats[Math.abs(slot) % seats.length];
    return { x: position.x + seat.x, y: position.y + seat.y };
  }
  const spread = stationPlacards.some((station) => station.node === node) ? stationSpread : waypointSpread;
  const row = spread[Math.min(Math.max(crowd, 1), spread.length) - 1];
  // Southern stations have shallow floors: the generic front row at +30
  // put dock occupants in the river and gate occupants through the fence.
  const shallow = crowd >= 4 && (node === "shipping_dock" || node === "permission_gate");
  // Past four, two staggered rows of four, still between the fence and the water.
  const southernRow = crowd > 4
    ? [{ x: -48, y: -12 }, { x: -18, y: -12 }, { x: 12, y: -12 }, { x: 42, y: -12 },
      { x: -33, y: 10 }, { x: -3, y: 10 }, { x: 27, y: 10 }, { x: 57, y: 10 }]
    : [{ x: -42, y: -12 }, { x: 24, y: -12 }, { x: -24, y: 10 }, { x: 42, y: 10 }];
  const offset = shallow ? southernRow[Math.abs(slot) % southernRow.length] : row[Math.abs(slot) % row.length];
  return { x: position.x + offset.x, y: position.y + offset.y };
}

export function hasBespokeSeats(node) {
  return Boolean(stationSeats[node]);
}

export function shortestPath(start, destination) {
  if (!nodes[start] || !nodes[destination]) return [];
  if (start === destination) return [start];
  const queue = [[start]];
  const visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    for (const next of graph[path.at(-1)] || []) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === destination) return candidate;
      visited.add(next);
      queue.push(candidate);
    }
  }
  return [];
}

export class AgentController {
  constructor({ start = "workbench", occupancySlot = 0, crowd = 1, speed = 82 } = {}) {
    this.currentNode = start;
    this.occupancySlot = occupancySlot;
    this.crowd = crowd;
    this.position = stationPosition(start, occupancySlot, crowd);
    this.speed = speed;
    this.path = [];
    this.state = VISUAL_STATES.ARRIVING;
    this.destination = start;
    this.direction = "down";
    this.moving = false;
    this.leaving = false;
  }

  /* The session is over: walk to the gate and out. State no longer steers
     this familiar — an ended session has no next station — so the route is
     set here and setState and setPlacement leave it alone. From wherever it
     stands, the way out runs through the campfire ring and down the south
     path, which is the walk the plate was drawn for. */
  leave() {
    if (this.leaving) return false;
    this.leaving = true;
    this.destination = EXIT_NODE;
    this.crowd = 1;
    this.occupancySlot = 0;
    const route = shortestPath(this.currentNode, EXIT_NODE);
    this.path = route.length ? route.slice(1) : [EXIT_NODE];
    this.moving = true;
    return true;
  }

  /* How far along the way out this familiar is, 0 at the turn and 1 at the
     gate, so the renderer can let it go gently rather than clip it. */
  get departure() {
    if (!this.leaving) return 0;
    const gate = nodes[EXIT_NODE];
    const remaining = Math.hypot(gate.x - this.position.x, gate.y - this.position.y);
    return Math.max(0, Math.min(1, 1 - remaining / FADE_DISTANCE));
  }

  /* How many familiars share this one's destination, and which of them it is.
     Re-routing afterwards is what makes the change visible: when a neighbour
     leaves, the one left behind walks to the middle of the station instead of
     staying in the spot it was given when the place was crowded. */
  setPlacement(slot, crowd) {
    if (this.leaving) return false;
    if (slot === this.occupancySlot && crowd === this.crowd) return false;
    this.occupancySlot = slot;
    this.crowd = crowd;
    this.setState(this.state);
    return true;
  }

  setState(state) {
    if (this.leaving) return false;
    const destination = destinationByState[state];
    if (!destination) return false;
    this.state = state;
    this.destination = destination;
    const currentTarget = stationPosition(this.currentNode, this.occupancySlot, this.crowd);
    const distanceFromCurrent = Math.hypot(this.position.x - currentTarget.x, this.position.y - currentTarget.y);
    const route = shortestPath(this.currentNode, destination);
    this.path = distanceFromCurrent < 0.01 ? route.slice(1) : route;
    this.moving = this.path.length > 0;
    return true;
  }

  update(deltaSeconds) {
    if (!this.path.length) {
      this.moving = false;
      return;
    }
    const targetName = this.path[0];
    const target = stationPosition(targetName, this.occupancySlot, this.crowd);
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    const distance = Math.hypot(dx, dy);
    const step = this.speed * deltaSeconds;
    this.direction = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    if (distance <= step) {
      this.position = { ...target };
      this.currentNode = targetName;
      this.path.shift();
      this.moving = this.path.length > 0;
      return;
    }
    this.position.x += (dx / distance) * step;
    this.position.y += (dy / distance) * step;
    this.moving = true;
  }
}
