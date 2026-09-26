import test from "node:test";
import assert from "node:assert/strict";
import { VISUAL_STATES } from "../src/state-machine.js";
import { nextStepCopy, stateCopy, stateLanguage } from "../src/state-language.js";

test("every internal state has plain-language UI copy and a visual cue", () => {
  for (const state of Object.values(VISUAL_STATES)) {
    assert.ok(stateLanguage[state], state + " is missing UI language");
    assert.ok(stateLanguage[state].label.length > 0);
    assert.ok(stateLanguage[state].description.endsWith("."));
    assert.ok(stateLanguage[state].cue.length > 0);
  }
});

test("raw internal identifiers do not leak into display labels", () => {
  assert.equal(stateCopy("needs_input").label, "Needs you");
  assert.equal(stateCopy("session_ended").label, "Unknown state");
  assert.equal(stateCopy("disconnected").label, "Unknown state");
});

test("only states that may require follow-up prescribe a next step, and it names the terminal", () => {
  assert.equal(stateCopy("editing").nextStep, undefined);
  assert.equal(nextStepCopy("editing", "VS Code ttys003 · web-app"), null);
  // "That session" is the question this screen exists to answer, so the step
  // says where — and still says something when the bridge could not place it.
  assert.equal(nextStepCopy("needs_input", "VS Code ttys003 · web-app"), "Answer it in VS Code ttys003 · web-app.");
  assert.equal(nextStepCopy("trouble", "iTerm ttys001"), "Check it in iTerm ttys001 when convenient.");
  assert.equal(nextStepCopy("needs_input", ""), "Answer it in its Claude Code terminal.");
  assert.ok(!/\{where\}/.test(nextStepCopy("trouble")), "the placeholder never reaches the page");
});
