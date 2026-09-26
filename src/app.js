import { applyTokens, toneVar } from "./design/tokens.js";
import { AgentRegistry } from "./agent-registry.js";
import { eventFreshness } from "./freshness.js";
import { WorldRenderer } from "./renderer.js";
import { FAMILIARS } from "./familiars.js";
import { agentLocation } from "./spatial-model.js";
import { deriveVisualState } from "./state-machine.js";
import { stateCopy } from "./state-language.js";
import { connectionStatus } from "./connection-status.js";
import { orderedSessions, updateSessionList, createSessionAnnouncer } from "./session-list.js";
import { chosenSessionName, sessionTitle, whereLabel } from "./session-address.js";
import { impatience, waitLabel } from "./familiar-moods.js";
import { landmarkAt } from "./world-art.js";

/* The stylesheet already declares these, so the first paint is correct without
   JavaScript. Writing them again here is what makes `design/tokens.js` the file
   that actually decides: change a colour there and both the canvas and the CSS
   follow, with a test to catch the day the two copies disagree. */
applyTokens();

const canvas = document.querySelector("#world");
const renderer = new WorldRenderer(canvas);
const registry = new AgentRegistry();
const history = [];
const narrow = window.matchMedia("(max-width: 860px)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastFrame = performance.now();
let hoveredId = null;

const ui = {
  picker: document.querySelector("#session-picker"),
  sessionList: document.querySelector("#session-list"),
  sessionsTitle: document.querySelector("#sessions-title"),
  sessionsSummary: document.querySelector("#sessions-summary"),
  sessionsClose: document.querySelector("#sessions-close"),
  name: document.querySelector("#agent-name"),
  species: document.querySelector("#agent-species"),
  subagents: document.querySelector("#subagent-value"),
  trail: document.querySelector("#agent-trail"),
  log: document.querySelector("#event-log"),
  repo: document.querySelector("#repo-value"),
  session: document.querySelector("#session-value"),
  task: document.querySelector("#task-value"),
  bridge: document.querySelector("#bridge-state"),
  attentionBanner: document.querySelector("#attention-banner"),
  attentionSummary: document.querySelector("#attention-summary"),
  attentionWhere: document.querySelector("#attention-where"),
  connectButton: document.querySelector("#connect-agent"),
  connectDot: document.querySelector("#connect-dot"),
  connectLabel: document.querySelector("#connect-label"),
  connectShort: document.querySelector("#connect-short"),
  setupStatus: document.querySelector("#setup-status"),
  setupDot: document.querySelector("#setup-dot"),
  setupText: document.querySelector("#setup-text"),
  repairCommand: document.querySelector("#repair-command"),
  statusCommand: document.querySelector("#status-command"),
  emptyWorld: document.querySelector("#empty-world"),
  hiddenNotice: document.querySelector("#hidden-notice"),
  freshness: document.querySelector("#freshness-value"),
  inspector: document.querySelector("#inspector"),
  portrait: document.querySelector("#agent-portrait"),
  roster: document.querySelector("#sr-roster"),
  live: document.querySelector("#live-status"),
  frame: document.querySelector("#world-frame"),
  cardClose: document.querySelector("#card-close"),
  connectDialog: document.querySelector("#connect-dialog"),
  devConsole: document.querySelector("#dev-console")
};

/* The drawer slides over the world rather than taking room from it. The frame
   never changes shape and the world never changes size, so opening a panel is
   a panel opening — not the whole scene rearranging itself around it.

   The board does not move for the chrome. That is the rule in every game that
   has a fixed board and a unit panel, and the alternative — sliding the camera
   so the selection clears the drawer — was tried and is worse here: the arrow
   keys cycle familiars, so it would lurch the whole world sideways on every
   keypress, and it would rescue only the one you picked while the other three
   stayed behind glass.

   What the world owes the drawer instead is an accounting. It is told how much
   of its right edge is covered, and anyone standing back there is redrawn as
   their badge in a column at the edge — so the panel can cost the map pixels
   and never cost it a session.

   On a phone the panel is stacked under the stage, so it covers nothing. */
function syncCover() {
  const covering = !ui.inspector.hidden && !narrow.matches;
  renderer.setCover(covering ? ui.inspector.getBoundingClientRect().width : 0);
}

/* The drawer slides out as well as in. `hidden` is what the rest of the app
   reads, so the close waits for the slide to finish before setting it — with
   reduced motion there is no slide to wait for. */
const DRAWER_SLIDE_MS = 180;
let drawerClosing = null;

function setDrawerOpen(open) {
  if (open) {
    clearTimeout(drawerClosing);
    drawerClosing = null;
    ui.inspector.classList.remove("closing");
    ui.inspector.hidden = false;
    return;
  }
  if (ui.inspector.hidden || drawerClosing) return;
  if (reducedMotion.matches) {
    ui.inspector.hidden = true;
    return;
  }
  ui.inspector.classList.add("closing");
  drawerClosing = setTimeout(() => {
    ui.inspector.hidden = true;
    ui.inspector.classList.remove("closing");
    drawerClosing = null;
    syncCover();
  }, DRAWER_SLIDE_MS);
}

const portraits = new Map(FAMILIARS.map(({ type, image }) => [type, image]));

/* One sentence per familiar, and the only place a screen reader ever hears what
   is happening on the map. The canvas has always been a picture with a label on
   it; with the names and the state words off the picture, this is the map. */
function sentenceFor(record) {
  const state = record.controller.state;
  const location = agentLocation(record.controller);
  const where = whereLabel(record);
  const waited = waitLabel(impatience(record).waited);
  const title = sessionTitle(record);
  return `${record.agentName}, ${record.familiarSpecies}${where ? `, in ${where}` : ""}${title ? `, on “${title}”` : ""}. ${stateCopy(state).label}${waited ? ` for ${spokenWait(waited)}` : ""}, ${location.label}. Updated ${eventFreshness(record.lastEventAt).label}.`;
}

// "1h 5m" read aloud as "1 hour 5 minutes".
function spokenWait(label) {
  return label.replace(/(\d+)h/, (_, n) => `${n} hour${n === "1" ? "" : "s"}`).replace(/(\d+)m/, (_, n) => `${n} minute${n === "1" ? "" : "s"}`);
}

/* Announced when the selection changes or when the selected session's state
   does — and at no other time. The inspector used to carry `aria-live` on the
   whole panel while `renderUI()` rewrote every field on a 15-second timer, so
   it read itself aloud on a loop and said nothing at all on the open. */
const sessionAnnouncement = createSessionAnnouncer();

function announce(record) {
  const message = sessionAnnouncement(registry.records.values(), record);
  if (message) ui.live.textContent = message;
}

let pickerAttentionOnly = false;
function renderSessionPicker() {
  if (!ui.picker.open) return;
  const records = orderedSessions(registry.records.values(), pickerAttentionOnly);
  ui.sessionsTitle.textContent = pickerAttentionOnly ? "Needs you" : "Sessions";
  ui.sessionsSummary.textContent = pickerAttentionOnly
    ? records.length ? `${records.length} waiting · oldest first. Inspecting a session does not dismiss its request.` : "No sessions need your input."
    : `${registry.records.size} connected · ${registry.visible.length} on the map. Select any session to inspect it.`;
  updateSessionList(ui.sessionList, records, {
    selectedId: registry.selectedId, visibleKeys: registry.visibleKeys, portraits,
    fallbackFocus: ui.sessionsClose,
    onSelect(key) { ui.picker.close(); canvas.focus(); select(key); }
  });
}
function openSessionPicker(attentionOnly = false) {
  pickerAttentionOnly = attentionOnly;
  ui.picker.showModal();
  renderSessionPicker();
  (ui.sessionList.querySelector("button") || ui.sessionsClose).focus();
}
ui.hiddenNotice.addEventListener("click", () => openSessionPicker());
ui.picker.addEventListener("close", () => {
  if (document.activeElement === document.body || document.activeElement?.hidden) canvas.focus();
});


/* A row that always reads "Not provided" is noise wearing a label. Facts that
   this session does not have simply do not appear. */
function setStat(field, value) {
  const row = field.parentElement;
  row.hidden = !value;
  if (value) field.textContent = value;
}

/* Selecting always reveals: a selection you cannot see is a dead end. */
function select(key) {
  registry.selectedId = key;
  renderUI();
}

function deselect() {
  registry.selectedId = null;
  renderUI();
}

/* Closing the drawer takes its close button with it, and focus falls to the
   body unless someone catches it. The map is where focus came from and where
   the arrow keys work, so the map is where it goes back to. */
function returnFocus() {
  if (ui.inspector.contains(document.activeElement)) canvas.focus();
}

/* Every state has its own colour now, so the panel reads the same custom
   property the canvas reads its tone from. Ten states used to share four
   colours here and five on the map, which meant the rail beside a name could
   disagree with the sign above its head. */
function toneColor(state) {
  return `var(${toneVar(state)})`;
}

function clockTime(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "--:--:--";
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function applySafeEvent(safe) {
  if (!safe) return;
  const record = registry.apply(safe);
  if (!record) return;
  history.unshift({ ...safe, visualState: safe.visualState || record.controller.state, removed: Boolean(record.removed) });
  history.splice(24);
  /* The goodbye, for anyone not looking at the map. Said once, here, because
     a departing familiar is no longer in the roster to be read from. */
  if (record.removed && record.leaving) ui.live.textContent = `${record.agentName} left the Patch.`;
  renderUI();
}

function renderUI() {
  const selected = registry.selected;
  /* The quiet clearing waits for the last familiar to be through the gate.
     Dropping the overlay the instant a session ends would hide the goodbye,
     and the goodbye is the one thing left on the map worth watching. */
  ui.emptyWorld.hidden = registry.drawn.length > 0;

  /* Counted across every connected session, not just the drawn ones. A session
     blocking on you always holds a place on the map, but the count must still
     be the truth rather than the part of it that fits. */
  const waiting = orderedSessions(registry.records.values(), true);
  ui.attentionBanner.hidden = waiting.length === 0;
  /* How long, once it has been long enough to matter. The list is oldest
     first, so the first entry is the one that has waited longest. */
  const waited = waiting.length ? waitLabel(impatience(waiting[0]).waited) : "";
  ui.attentionSummary.textContent = (waiting.length === 1
    ? `${waiting[0].agentName} needs you`
    : `${waiting.length} sessions need you`) + (waited ? ` · ${waiting.length === 1 ? "" : "oldest "}${waited}` : "");
  /* Where to go, in the alert itself. One waiting session names its terminal;
     several would be a list, and the map is the list. */
  const where = waiting.length === 1 ? whereLabel(waiting[0]) : "";
  ui.attentionWhere.hidden = !where;
  ui.attentionWhere.textContent = where;
  ui.attentionBanner.title = waiting.length === 1 && where ? `Go to ${where}` : "";

  const hidden = registry.hidden;
  ui.hiddenNotice.hidden = hidden.length === 0;
  ui.hiddenNotice.textContent = `+${hidden.length} not shown`;
  ui.hiddenNotice.title = hidden.length
    ? `Connected but off the map: ${hidden.map((record) => `${record.agentName} (${stateCopy(record.controller.state).label})`).join(", ")}`
    : "";

  // The drawer exists only while a familiar is selected. There is no visible
  // roster and no counter: the familiars are already on screen.
  if (!selected) returnFocus();
  setDrawerOpen(Boolean(selected));
  announce(selected);
  if (selected) {
    const state = selected.controller.state;
    /* A familiar on its way out is still in the panel until it is through
       the gate, its portrait ringed in the disconnected grey. */
    const leaving = Boolean(selected.leaving);
    const tone = toneColor(leaving ? "disconnected" : state);
    ui.name.textContent = selected.agentName;
    ui.species.textContent = selected.familiarSpecies;
    ui.portrait.style.backgroundImage = `url("${portraits.get(selected.familiarType) || ""}")`;
    ui.portrait.style.borderColor = tone;
    /* The title leads, the way it does on the tab. A /rename is both the
       title and the session name; it is said once. */
    const title = sessionTitle(selected);
    ui.task.hidden = !title;
    ui.task.textContent = title;
    ui.task.title = title;
    const chosen = chosenSessionName(selected);
    setStat(ui.session, chosen === title ? "" : chosen);
    setStat(ui.repo, selected.repository);
    setStat(ui.subagents, selected.subagents ? String(selected.subagents) : "");
    // The row is already labelled UPDATED; the value need not say it again.
    setStat(ui.freshness, eventFreshness(selected.lastEventAt).label.replace(/^Updated /, ""));

    /* The history, present first: with no state line above it, the top
       entry is the only place the panel says what it is doing now. */
    ui.trail.replaceChildren(...selected.trail.map((step) => {
      const item = document.createElement("li");
      const time = document.createElement("time");
      time.textContent = clockTime(step.at);
      const label = document.createElement("span");
      label.textContent = stateCopy(step.state).label;
      label.style.color = toneColor(step.state);
      item.append(time, label);
      return item;
    }));
  }
  // Readable to assistive technology without invisible keyboard stops.
  // Actual session controls live in the visible, keyed picker.
  const accessibleRows = new Map([...ui.roster.children].map((item) => [item.dataset.key, item]));
  for (const record of registry.records.values()) {
    let item = accessibleRows.get(record.key);
    if (!item) { item = document.createElement("li"); item.dataset.key = record.key; ui.roster.append(item); }
    accessibleRows.delete(record.key);
    const sentence = `${registry.visibleKeys.includes(record.key) ? "" : "Off map. "}${sentenceFor(record)}`;
    if (item.textContent !== sentence) item.textContent = sentence;
  }
  for (const item of accessibleRows.values()) item.remove();
  renderSessionPicker();

  syncCover();
  applySetup(setupState);

  ui.log.replaceChildren(...history.map((entry) => {
    const item = document.createElement("li");
    if (entry.type === "refused") {
      item.textContent = `${clockTime(entry.timestamp)} · ${entry.agentName} · refused → ${entry.refusalReason}`;
      return item;
    }
    const result = entry.removed ? "Left Patch" : stateCopy(entry.visualState).label;
    item.textContent = `${clockTime(entry.timestamp)} · ${entry.agentName} · ${entry.type.replaceAll("_", " ")} → ${result}`;
    return item;
  }));
}

ui.connectButton.addEventListener("click", () => ui.connectDialog.showModal());

// Bridge health, installed configuration, and actual hook delivery are
// independent evidence. Notes can discover sessions without any hook event.
let setupState = null;
let deliveryState = null;
let bridgeAvailability = "connecting";

function applySetup(setup) {
  if (setup !== undefined) setupState = setup || null;
  const status = connectionStatus({ setup: setupState, delivery: deliveryState,
    bridge: bridgeAvailability, sessions: registry.records.size });
  ui.connectButton.classList.toggle("connected", status.active);
  // The map is the page; once Claude Code is connected the button is a fact
  // nobody needs to read, so it leaves the corner. C still opens the guide.
  ui.connectButton.hidden = status.settled;
  ui.connectDot.hidden = !status.active;
  ui.connectDot.className = "dot finished";
  ui.connectLabel.textContent = status.label;
  ui.connectShort.textContent = status.short;
  ui.connectButton.title = status.details;
  ui.setupStatus.hidden = false;
  ui.setupDot.hidden = !status.active;
  ui.setupDot.className = "dot finished";
  ui.setupText.textContent = status.details;
  // The bridge knows the exact commands for this install, npx or global.
  if (setupState?.repairCommand) ui.repairCommand.textContent = setupState.repairCommand;
  if (setupState?.statusCommand) ui.statusCommand.textContent = setupState.statusCommand;
}

ui.cardClose.addEventListener("click", () => {
  deselect();
  returnFocus();
});

/* The banner is its own opener and its own disappearing act: selecting the
   waiting session can be the very thing that hides it. Focus moves to the map
   first, so pressing it never drops the keyboard on the floor. */
ui.attentionBanner.addEventListener("click", () => {
  const waiting = orderedSessions(registry.records.values(), true);
  if (waiting.length > 1) openSessionPicker(true);
  else if (waiting.length) { canvas.focus(); select(waiting[0].key); }
});

/* Map controls. Familiars are canvas pixels, so the keyboard needs its own way
   to reach them — the arrows walk the roster the roster used to provide. */
document.addEventListener("keydown", (event) => {
  if (ui.connectDialog.open || ui.picker.open || event.metaKey || event.ctrlKey || event.altKey) return;
  // Somebody typing is not somebody steering the map.
  if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
  if (/^(input|textarea|select)$/i.test(event.target?.tagName || "")) return;
  if (event.key === "Escape" && !ui.devConsole.hidden) {
    ui.devConsole.hidden = true;
  } else if (event.key === "Escape" && registry.selectedId) {
    deselect();
    returnFocus();
  } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    if (!registry.records.size) return;
    event.preventDefault();
    registry.cycle(event.key === "ArrowRight" ? 1 : -1);
    renderUI();
  } else if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    openSessionPicker();
  } else if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    ui.connectDialog.showModal();
  } else if (event.key === "`" || event.key === "~") {
    event.preventDefault();
    ui.devConsole.hidden = !ui.devConsole.hidden;
  }
});

function pointAt(event) {
  const bounds = canvas.getBoundingClientRect();
  return renderer.toWorld(event.clientX - bounds.left, event.clientY - bounds.top);
}

function edgeRecordAt(event) {
  const bounds = canvas.getBoundingClientRect();
  return renderer.edgeRecordAt(registry.drawn, event.clientX - bounds.left, event.clientY - bounds.top);
}

// Canvas clicks resolve in logical world units, whatever the display size is.
/* A familiar always wins the click. Past that, the fire and the boat answer a
   poke without touching the selection — poking the world is not "click open
   ground to close the panel", it is just poking the world. */
canvas.addEventListener("click", (event) => {
  const point = pointAt(event);
  const record = edgeRecordAt(event) || registry.findNearest(point.x, point.y);
  if (record) select(record.key);
  else if (renderer.poke(landmarkAt(point), performance.now())) return;
  else if (registry.selectedId) deselect();
});

canvas.addEventListener("pointermove", (event) => {
  const point = pointAt(event);
  const record = edgeRecordAt(event) || registry.findNearest(point.x, point.y, 28, { departing: true });
  hoveredId = record?.key || null;
  canvas.style.cursor = record || landmarkAt(point) ? "pointer" : "default";
});
canvas.addEventListener("pointerleave", () => {
  hoveredId = null;
  canvas.style.cursor = "default";
});

/* The bridge beats every 15 seconds. Missing two of them means the stream is
   gone whether or not the socket admitted it — which is the failure that matters,
   because a laptop waking from sleep leaves a connection that is open and dead.
   Without this the world keeps showing familiars frozen at whatever they were
   doing an hour ago, and looks exactly like a world that is up to date. */
const STREAM_SILENCE_MS = 40_000;
let lastStreamAt = Date.now();
let streamTrouble = null;

/* A refused event is the bridge turning something away that could not name a
   running Claude Code session. Usually that is exactly right and you never want
   to hear about it — but if the refusals are your own agent, the world goes
   quiet and looks like a workshop with nobody in it. So the chip says so, and
   says for how long, rather than letting a wrong refusal pass for an empty day. */
const REFUSAL_NOTICE_MS = 5 * 60_000;
let refusal = null;

function noteRefusal(entry) {
  const count = refusal && Date.now() - refusal.at < REFUSAL_NOTICE_MS ? refusal.count + 1 : 1;
  refusal = { at: Date.now(), reason: entry.reason, sender: entry.agentName, count };
}

/* One chip, one owner. A dead stream outranks a refusal, and a healthy bridge
   with nothing to report says nothing at all. */
function syncBridgeChip() {
  applySetup(setupState);
  if (streamTrouble) {
    ui.bridge.hidden = false;
    ui.bridge.replaceChildren(dot("trouble"), text(streamTrouble));
    return;
  }
  if (refusal && Date.now() - refusal.at < REFUSAL_NOTICE_MS) {
    ui.bridge.hidden = false;
    ui.bridge.replaceChildren(dot("trouble"), text(refusal.count === 1 ? "1 event refused" : `${refusal.count} events refused`));
    ui.bridge.title = `${refusal.reason}. Nothing was drawn for it.`;
    return;
  }
  ui.bridge.hidden = true;
  ui.bridge.title = "";
}

function markStreamAlive() {
  lastStreamAt = Date.now();
  streamTrouble = null;
  bridgeAvailability = "live";
  syncBridgeChip();
}

function showBridgeTrouble(message) {
  streamTrouble = message;
  bridgeAvailability = "offline";
  syncBridgeChip();
}

function dot(tone) {
  const node = document.createElement("i");
  node.className = `dot ${tone}`;
  return node;
}

function text(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node;
}

const eventSource = new EventSource("/api/events/stream");
eventSource.addEventListener("open", markStreamAlive);
/* The first message and every beat carry the install check, so a `connect`
   run in another terminal reaches the bar within fifteen seconds. */
function withSetup(event) {
  markStreamAlive();
  try {
    const payload = JSON.parse(event.data);
    deliveryState = payload.delivery || null;
    applySetup(payload.setup);
  } catch { /* A beat without a body is still a beat. */ }
}
eventSource.addEventListener("ready", withSetup);
eventSource.addEventListener("patch-beat", withSetup);
eventSource.addEventListener("patch-delivery", (event) => {
  markStreamAlive();
  try { deliveryState = JSON.parse(event.data); applySetup(setupState); } catch { /* Ignore malformed diagnostics. */ }
});
eventSource.addEventListener("patch-event", (event) => {
  markStreamAlive();
  try { applySafeEvent(JSON.parse(event.data)); } catch { /* The bridge ignores malformed stream entries. */ }
});
/* A session renamed itself, or the bridge learned which terminal it is in.
   Identity only: nothing moves, and nothing lands in the event log. */
eventSource.addEventListener("patch-session", (event) => {
  markStreamAlive();
  try {
    const session = JSON.parse(event.data);
    const record = registry.records.get(session?.sessionId);
    if (!record) return;
    if (session.sessionName) {
      record.sessionName = session.sessionName;
      record.sessionNameSource = session.sessionNameSource || null;
    }
    if (session.terminalProgram) record.terminalProgram = session.terminalProgram;
    if (session.terminalTty) record.terminalTty = session.terminalTty;
    renderUI();
  } catch { /* A malformed identity update must not break the live stream. */ }
});
eventSource.addEventListener("patch-snapshot", (event) => {
  markStreamAlive();
  try {
    const snapshot = JSON.parse(event.data);
    if (!Array.isArray(snapshot)) return;
    const selectedId = registry.selectedId;
    registry.clear();
    for (const safe of snapshot) registry.apply(safe);
    if (registry.records.has(selectedId)) registry.selectedId = selectedId;
    renderUI();
  } catch { /* A malformed snapshot must not break the live stream. */ }
});
/* Refusals never reach the registry: nothing is drawn, moved, or removed for
   one. They land in the log so the reason survives, and in the chip so the
   operator can see that the silence has a cause. */
eventSource.addEventListener("patch-refused", (event) => {
  markStreamAlive();
  try {
    const entry = JSON.parse(event.data);
    noteRefusal(entry);
    history.unshift({
      timestamp: entry.at, agentName: entry.agentName || "unknown sender",
      type: "refused", refusalReason: entry.reason
    });
    history.splice(24);
    renderUI();
  } catch { /* A malformed refusal must not break the live stream. */ }
});

eventSource.addEventListener("error", () => showBridgeTrouble("Reconnecting"));

setInterval(() => {
  if (Date.now() - lastStreamAt > STREAM_SILENCE_MS) showBridgeTrouble("Bridge not responding");
  else syncBridgeChip();
}, 5_000);

/* The stage changes with the viewport. Watch the frame, never the canvas: resize() rewrites the canvas's
   backing store, so observing the canvas feeds itself an endless resize loop
   that leaves the world cleared and blank. */
new ResizeObserver(() => renderer.resize()).observe(document.querySelector("#world-stage"));
new ResizeObserver(() => syncCover()).observe(ui.inspector);
window.addEventListener("resize", () => renderer.resize());
narrow.addEventListener("change", syncCover);

await renderer.ready;
renderer.resize();
renderUI();
setInterval(renderUI, 15_000);

function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  const arrivalChanged = registry.update(delta);
  if (arrivalChanged) renderUI();
  renderer.draw(registry.drawn, now, registry.selectedId, hoveredId);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export { applySafeEvent, deriveVisualState, registry };
