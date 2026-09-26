import { VISUAL_STATES } from "./state-machine.js";

export const stateLanguage = Object.freeze({
  [VISUAL_STATES.ARRIVING]: { label: "Starting", description: "The session is connecting to its workbench.", cue: "arrive", nextStep: null },
  [VISUAL_STATES.IDLE]: { label: "Idle", description: "Nothing has happened here for a while. The session is open and waiting for work.", cue: "rest", nextStep: null },
  [VISUAL_STATES.PREPARING]: { label: "Getting started", description: "The agent received a request and is preparing.", cue: "prepare" },
  [VISUAL_STATES.INVESTIGATING]: { label: "Researching", description: "The agent is reading or searching.", cue: "page" },
  [VISUAL_STATES.EDITING]: { label: "Editing", description: "The agent is changing project files.", cue: "spark" },
  [VISUAL_STATES.RUNNING]: { label: "Running command", description: "The agent started a command or tool.", cue: "pulse" },
  [VISUAL_STATES.TESTING]: { label: "Testing", description: "The agent is running checks.", cue: "check" },
  /* `{where}` is the session's address — "VS Code ttys003 · web-app" — filled
     in by nextStepCopy. A next step that says "that session" leaves the one
     question this screen exists to answer: which window. */
  [VISUAL_STATES.NEEDS_INPUT]: { label: "Needs you", description: "The session is waiting for your input or permission.", cue: "attention", nextStep: "Answer it in {where}." },
  [VISUAL_STATES.TROUBLE]: { label: "Trouble", description: "The latest tool or turn reported a failure.", cue: "error", nextStep: "Check it in {where} when convenient." },
  [VISUAL_STATES.FINISHED]: { label: "Done", description: "The agent stopped working and handed the turn back to you.", cue: "parcel", nextStep: null }
});

export function stateCopy(state) {
  return stateLanguage[state] || { label: "Unknown state", description: "The adapter sent an unsupported state.", cue: "unknown" };
}

/* What the inspector says about a familiar on its way out. Not a lifecycle
   state — an ended session has no next station — so it lives beside the
   state table rather than in it. The reason is the bridge's own: the session
   said goodbye, or its process was found gone. */
export const farewellLanguage = Object.freeze({
  label: "Left",
  session_ended: "The session ended. Its familiar is walking out through the gate.",
  disconnected: "Claude Code stopped without saying goodbye. Its familiar is walking out through the gate."
});

export function farewellCopy(reason) {
  return {
    label: farewellLanguage.label,
    description: farewellLanguage[reason] || farewellLanguage.session_ended,
    cue: "leave",
    nextStep: null
  };
}

/* The next step with the address filled in. A session the bridge could not
   place still gets a sentence, pointed at the only thing that is known. */
export function nextStepCopy(state, where = "") {
  const template = stateCopy(state).nextStep;
  if (!template) return null;
  return template.replace("{where}", where || "its Claude Code terminal");
}
