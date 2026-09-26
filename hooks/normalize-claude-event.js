import { basename } from "node:path";

const readTools = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
const editTools = new Set(["Edit", "Write", "NotebookEdit"]);
const testPattern = /(?:^|\s|\/)(?:npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|pytest|vitest|jest|cargo\s+test|go\s+test)(?:\s|$)/i;

/* Every hook Claude Code fires inside a subagent carries `agent_id` and
   `agent_type`; hooks on the session's own thread carry neither (verified
   against a live session: SubagentStart, and the helper's own PreToolUse and
   PostToolUse, name the agent; SessionStart, UserPromptSubmit, Stop and the
   parent's tool hooks do not). A helper's work is not the session's state — a
   parent waiting on three Explore helpers is not "Researching" three times a
   second — so only the helper lifecycle itself and anything that needs the
   user come out of a helper. The helper's name never reaches the map either:
   the familiar is the session, and it keeps the name Daemonwood gave it. */
function insideHelper(input) {
  return Boolean(input.agent_id);
}

/* `title` is the session's tab title, read from its transcript by the hook
   (see session-title.js). It travels as the event's task label: the one line
   that says what this session is about. */
export function normalizeClaudeHook(input, { title = null, env = {} } = {}) {
  if (!input || typeof input !== "object") return null;
  const common = {
    id: `${input.session_id || "unknown"}:${input.hook_event_name || "unknown"}:${Date.now()}`,
    sessionId: String(input.session_id || "unknown-session"),
    timestamp: new Date().toISOString(),
    repository: repositoryAlias(input.cwd),
    agentName: "Claude"
  };
  if (typeof title === "string" && title) common.taskLabel = title.slice(0, 80);
  const terminal = terminalLabel(env);
  if (terminal) common.terminalProgram = terminal;
  const helper = insideHelper(input);

  switch (input.hook_event_name) {
    case "SessionStart": return helper ? null : { ...common, type: "session_started" };
    case "UserPromptSubmit": return helper ? null : { ...common, type: "prompt_submitted" };
    case "PreToolUse": return helper ? null : { ...common, type: "tool_started", category: categorizeTool(input) };
    /* A permission dialog blocks the user whichever thread asked for it. */
    case "PermissionRequest": return { ...common, type: "needs_input" };
    /* "After auto mode classifier denies a tool call" — Claude Code's own
       description. Nobody is being asked anything; a tool call was refused and
       the agent carries on with that answer. That is Trouble, the same as any
       other tool that did not run, and never Needs you. Parking a familiar at
       the Permission Gate for it is the exact lie this product exists to
       prevent: a prompt on the map that nobody is waiting behind. */
    case "PermissionDenied": return helper ? null : { ...common, type: "failure" };
    case "Notification": return normalizeNotification(input, common, helper);
    case "SubagentStart": return { ...common, type: "subagent_started" };
    case "SubagentStop": return { ...common, type: "subagent_stopped" };
    /* TaskCreated and TaskCompleted fire when the session's own task list
       changes — the TaskCreate and TaskUpdate tools — with task_id and
       task_subject, and a teammate_name only when a teammate is involved.
       A to-do item is not a helper: counting them once showed five helpers on
       a session that had none. They are no longer subscribed to; an old
       install that still sends them is ignored here. */
    case "TaskCreated":
    case "TaskCompleted": return null;
    case "Stop": return helper ? null : { ...common, type: "stopped" };
    case "StopFailure":
    case "PostToolUseFailure": return helper ? null : { ...common, type: "failure" };
    case "SessionEnd": return helper ? null : { ...common, type: "session_ended" };
    default: return null;
  }
}

function categorizeTool(input) {
  if (readTools.has(input.tool_name)) return "read";
  if (editTools.has(input.tool_name)) return "edit";
  if (input.tool_name === "Bash") {
    const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
    return testPattern.test(command) ? "test" : "command";
  }
  return "command";
}

function normalizeNotification(input, common, helper) {
  if (["permission_prompt", "agent_needs_input", "elicitation_dialog", "elicitation_url_dialog"].includes(input.notification_type)) {
    return { ...common, type: "needs_input" };
  }
  if (helper) return null;
  if (input.notification_type === "idle_prompt") return { ...common, type: "stopped" };
  if (input.notification_type === "agent_completed") return { ...common, type: "completed" };
  return null;
}

function repositoryAlias(cwd) {
  if (!cwd || typeof cwd !== "string") return "unlabeled-repo";
  return basename(cwd) || "unlabeled-repo";
}

/* The terminal app the session is running in, as a label a person would use:
   "VS Code", "iTerm", "Terminal". The hook inherits the session's environment,
   and every terminal names itself there. Only the label leaves the machine's
   own process — per-tab ids like TERM_SESSION_ID are useful to nobody else
   and stay where they are. A tmux pane is named because it is the one
   address a person can actually jump to. */
const terminalPrograms = Object.freeze({
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm",
  vscode: "VS Code",
  tmux: "tmux",
  WezTerm: "WezTerm",
  ghostty: "Ghostty",
  kitty: "kitty",
  WarpTerminal: "Warp",
  Hyper: "Hyper",
  Alacritty: "Alacritty",
  Tabby: "Tabby"
});

export function terminalLabel(env = {}) {
  const program = typeof env.TERM_PROGRAM === "string" ? env.TERM_PROGRAM.trim() : "";
  let label = terminalPrograms[program] || (program ? program.replace(/[^\w .-]/g, "").slice(0, 24) : "");
  if (!label && env.ALACRITTY_WINDOW_ID) label = "Alacritty";
  if (!label && env.KITTY_WINDOW_ID) label = "kitty";
  const pane = typeof env.TMUX_PANE === "string" ? env.TMUX_PANE.trim().slice(0, 8) : "";
  if (pane && label !== "tmux") return label ? `${label} · tmux ${pane}` : `tmux ${pane}`;
  if (pane) return `tmux ${pane}`;
  return label || null;
}
