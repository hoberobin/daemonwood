export const VISUAL_STATES = Object.freeze({
  ARRIVING: "arriving",
  IDLE: "idle",
  PREPARING: "preparing",
  INVESTIGATING: "investigating",
  EDITING: "editing",
  RUNNING: "running",
  TESTING: "testing",
  NEEDS_INPUT: "needs_input",
  TROUBLE: "trouble",
  FINISHED: "finished"
});

/* Every way a session can leave the Patch. `disconnected` is the bridge's own
   verdict on a session whose process is gone, `unproven` its verdict on one
   Claude Code turns out never to have opened, and `superseded` its verdict on
   one whose process now hosts a different session — `/clear` gives a terminal
   a new session id without a new process. All three stay in this set so the
   reaper's removals are ordinary protocol, not a side door. */
const removalEvents = new Set(["session_ended", "disconnected", "unproven", "superseded", "reset"]);

const eventMap = Object.freeze({
  session_started: VISUAL_STATES.ARRIVING,
  prompt_submitted: VISUAL_STATES.PREPARING,
  read: VISUAL_STATES.INVESTIGATING,
  search: VISUAL_STATES.INVESTIGATING,
  edit: VISUAL_STATES.EDITING,
  write: VISUAL_STATES.EDITING,
  command: VISUAL_STATES.RUNNING,
  test: VISUAL_STATES.TESTING,
  permission_requested: VISUAL_STATES.NEEDS_INPUT,
  needs_input: VISUAL_STATES.NEEDS_INPUT,
  failure: VISUAL_STATES.TROUBLE,
  completed: VISUAL_STATES.FINISHED,
  /* No Claude hook says "the whole task is complete" for a foreground
     session: the end of a turn is all it reports. So the end of a turn
     is what DONE means here — the agent stopped working and the next move is
     yours. IDLE is not an event at all; it is DONE that nobody came back to,
     and `restingStateFor` below ages one into the other. */
  stopped: VISUAL_STATES.FINISHED,
  session_ended: null,
  disconnected: null,
  unproven: null,
  superseded: null,
  reset: null
});

/* How long a finished session stands at the Shipping Dock before it wanders to
   the campfire. Long enough that a turn you are actively watching stays DONE,
   short enough that a session you walked away from stops claiming your eye. */
export const IDLE_AFTER_MS = 5 * 60_000;

/* Resting states age; working states do not. A session that has been RUNNING
   for an hour is still running as far as any hook knows, and the freshness line
   already says how long it has been quiet. Nor may NEEDS_INPUT or TROUBLE decay:
   those two exist to keep asking. */
const agesToIdle = new Set([VISUAL_STATES.FINISHED, VISUAL_STATES.ARRIVING]);

export function restingStateFor(state, lastEventAt, now = Date.now()) {
  if (!agesToIdle.has(state)) return state;
  const timestamp = Date.parse(lastEventAt || "");
  if (!Number.isFinite(timestamp)) return state;
  return now - timestamp >= IDLE_AFTER_MS ? VISUAL_STATES.IDLE : state;
}

export function deriveVisualState(event) {
  if (!event || typeof event.type !== "string") return null;
  if (event.type === "tool_started") {
    return eventMap[event.category] || VISUAL_STATES.RUNNING;
  }
  return eventMap[event.type] || null;
}

export function sanitizeHookEvent(raw) {
  const state = deriveVisualState(raw);
  const isSubagentEvent = raw?.type === "subagent_started" || raw?.type === "subagent_stopped";
  const removesSession = removalEvents.has(raw?.type);
  if (!state && !isSubagentEvent && !removesSession) return null;
  return {
    id: String(raw.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`),
    sessionId: String(raw.sessionId || "local-session"),
    agentName: safeLabel(raw.agentName, "Agent", 40),
    timestamp: String(raw.timestamp || new Date().toISOString()),
    type: String(raw.type),
    category: raw.category ? String(raw.category) : undefined,
    repository: raw.repository ? String(raw.repository).split(/[\\/]/).filter(Boolean).at(-1) : "unlabeled-repo",
    taskLabel: raw.taskLabel ? String(raw.taskLabel).slice(0, 80) : "Unlabeled task",
    visualState: state,
    removesSession,
    requiresAttention: state === VISUAL_STATES.NEEDS_INPUT,
    subagentDelta: raw.type === "subagent_started" ? 1 : raw.type === "subagent_stopped" ? -1 : 0,
    ownerPid: safePid(raw.ownerPid),
    ownerStartedAt: safeProcessToken(raw.ownerStartedAt),
    /* Which terminal app the session is typed into: a label like "VS Code" or
       "iTerm", never a tab id or a path. The bridge adds the tty from `ps`
       itself, and names the familiar itself — neither is a sender's to claim. */
    terminalProgram: safeLabel(raw.terminalProgram, "", 32) || undefined
  };
}

function safePid(value) {
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
}

function safeProcessToken(value) {
  if (typeof value !== "string") return undefined;
  const token = value.replace(/[^A-Za-z0-9 :+-]/g, "").trim().slice(0, 64);
  return token || undefined;
}

function safeLabel(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const label = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
  return label || fallback;
}

export function summarizeSessions(sessions) {
  const values = [...sessions.values()];
  return {
    active: values.filter((session) => ![VISUAL_STATES.FINISHED, VISUAL_STATES.IDLE, VISUAL_STATES.NEEDS_INPUT].includes(session.state)).length,
    waiting: values.filter((session) => session.state === VISUAL_STATES.NEEDS_INPUT).length,
    finished: values.filter((session) => session.state === VISUAL_STATES.FINISHED).length
  };
}
